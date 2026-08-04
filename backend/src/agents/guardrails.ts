/**
 * Output guardrails.
 *
 * The prompt tells the model the rules; this module enforces them. Prompts are
 * persuasion, not control — a model under pressure from a persistent prospect
 * will eventually promise a free roof. These checks run on every generated
 * reply before a single word is spoken.
 *
 * Enforces claude.md §5 (never break character, never reveal internals, never
 * hallucinate product facts) and the hard-blocked claims in
 * fallback-responses.md §3.
 */

export interface GuardrailViolation {
  rule: string;
  detail: string;
  /** 'block' replies cannot be spoken at all; 'rewrite' ones are repaired. */
  severity: 'block' | 'rewrite';
}

export interface GuardrailResult {
  text: string;
  violations: GuardrailViolation[];
  blocked: boolean;
}

/**
 * Claims the agent must never make. Each pattern is deliberately narrow:
 * "guarantee" alone would catch legitimate warranty talk, so the patterns
 * target the promise, not the vocabulary.
 */
const BANNED_CLAIMS: { pattern: RegExp; rule: string }[] = [
  { pattern: /\byou(?:'re| are) (?:definitely |already )?(?:approved|qualified)\b/i, rule: 'promises_approval' },
  { pattern: /\b(?:i|we) guarantee\b/i, rule: 'guarantees_outcome' },
  { pattern: /\bguaranteed (?:savings|approval|to save)\b/i, rule: 'guarantees_outcome' },
  { pattern: /\byou will (?:definitely )?save \$?\d+/i, rule: 'promises_specific_savings' },
  { pattern: /\byour roof will be free\b/i, rule: 'promises_free_roof' },
  { pattern: /\bfree roof\b(?!.*\bnot promising\b)/i, rule: 'promises_free_roof' },
  { pattern: /\b(?:it(?:'s| is)|this is) (?:completely|totally|100%) free\b/i, rule: 'promises_free' },
  { pattern: /\bwe(?:'re| are) (?:with|from) the (?:government|utility|power company)\b/i, rule: 'false_affiliation' },
  { pattern: /\b(?:30|thirty)\s*(?:to|-|–)\s*(?:50|fifty)\s*%/i, rule: 'wrong_savings_range' },
  { pattern: /\bno credit check\b/i, rule: 'false_credit_claim' },
  // Caught in end-to-end testing: the model volunteered "PG&E is one of our
  // partner providers", which is nowhere in the knowledge base. Any claimed
  // relationship with a utility is invented.
  { pattern: /\bpartner (?:provider|utility|compan)/i, rule: 'invented_partnership' },
  // Any claimed relationship with the prospect's utility is invented — the
  // knowledge base describes no such arrangement. Caught twice in E2E testing
  // as "PG&E is one of our partner providers" / "one of the providers we work
  // with", so the pattern covers the paraphrase too.
  {
    pattern:
      /\b(?:is|are) (?:one of )?(?:the |our )?(?:providers?|utilities|companies) (?:we|that we) (?:work|partner|deal) with\b/i,
    rule: 'invented_partnership',
  },
  { pattern: /\bwe (?:work|partner) (?:with|directly with) (?:your |the )?(?:utility|power company)\b/i, rule: 'invented_partnership' },
];

/** Phrases that would reveal the machinery behind the conversation. */
const LEAK_PATTERNS: { pattern: RegExp; rule: string }[] = [
  { pattern: /\b(?:system|my) prompt\b/i, rule: 'reveals_prompt' },
  { pattern: /\bmy instructions\b/i, rule: 'reveals_prompt' },
  { pattern: /\bknowledge (?:base|document)\b/i, rule: 'reveals_knowledge_base' },
  { pattern: /\b(?:the |a )?(?:sales )?script\b/i, rule: 'reveals_script' },
  { pattern: /\bPDF\b/i, rule: 'reveals_source' },
  { pattern: /\bstage\s*[:=]/i, rule: 'reveals_stage' },
  {
    pattern: /\b(?:opening|rapport|qualification|need_discovery|value_pitch|objection_handling)\b/i,
    rule: 'reveals_stage',
  },
  { pattern: /\bqualification[_ ]score\b/i, rule: 'reveals_score' },
  { pattern: /\blead[_ ]patch\b|\blead object\b/i, rule: 'reveals_internals' },
  { pattern: /\bas an? (?:AI )?language model\b/i, rule: 'breaks_character' },
];

/** Counts genuine questions, ignoring rhetorical "right?" style tags. */
export function countQuestions(text: string): number {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.filter((s) => {
    const trimmed = s.trim();
    if (!trimmed.endsWith('?')) return false;
    // "Does that sound fair?" and "right?" are confirmations, not new asks.
    if (/^(?:right|okay|ok|correct|does that sound fair|fair enough|sound good)\s*\?$/i.test(trimmed)) {
      return false;
    }
    return true;
  }).length;
}

/** Strips anything that looks like structured output leaking into speech. */
function stripStructuredOutput(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Truncates to the first N questions, keeping everything before the second one.
 * Sales rule from the script: one question per turn, always.
 */
function truncateToOneQuestion(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  let questions = 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length === 0) continue;

    const isQuestion =
      trimmed.endsWith('?') &&
      !/^(?:right|okay|ok|correct|does that sound fair|fair enough|sound good)\s*\?$/i.test(trimmed);

    if (isQuestion) {
      if (questions >= 1) break;
      questions += 1;
    }
    kept.push(trimmed);
  }

  return kept.join(' ');
}

export interface ApplyGuardrailsOptions {
  /** Closing recap legitimately covers five points at once. */
  allowMultipleSentences?: boolean;
  /** Closing is the one stage exempt from the one-question rule. */
  enforceOneQuestion?: boolean;
}

/**
 * Runs a generated reply through every guardrail.
 *
 * `blocked: true` means the reply must not be spoken and the caller should
 * fall back to a safe line — never "best effort" a reply that promises
 * something the company cannot deliver.
 */
export function applyGuardrails(
  raw: string,
  options: ApplyGuardrailsOptions = {},
): GuardrailResult {
  const { enforceOneQuestion = true } = options;
  const violations: GuardrailViolation[] = [];

  let text = stripStructuredOutput(raw);

  for (const { pattern, rule } of BANNED_CLAIMS) {
    if (pattern.test(text)) {
      violations.push({
        rule,
        detail: `Reply matched a hard-blocked claim: ${pattern}`,
        severity: 'block',
      });
    }
  }

  for (const { pattern, rule } of LEAK_PATTERNS) {
    if (pattern.test(text)) {
      violations.push({
        rule,
        detail: `Reply would reveal internal machinery: ${pattern}`,
        severity: 'block',
      });
    }
  }

  if (enforceOneQuestion && countQuestions(text) > 1) {
    violations.push({
      rule: 'multiple_questions',
      detail: 'Reply contained more than one question; truncated to the first.',
      severity: 'rewrite',
    });
    text = truncateToOneQuestion(text);
  }

  if (text.length === 0) {
    violations.push({ rule: 'empty_reply', detail: 'Reply was empty.', severity: 'block' });
  }

  return {
    text,
    violations,
    blocked: violations.some((v) => v.severity === 'block'),
  };
}

/**
 * Safe replies used when a generated turn is blocked.
 * Varied so a repeated guardrail hit does not produce a robotic loop.
 */
const SAFE_FALLBACKS = [
  "I'm actually not 100% sure about that, and I'd rather not give you incorrect information. Let me make a note for the engineer so they can go over it with you.",
  "Honestly, I don't want to give you the wrong answer on that one. I'll put a note down so the engineer covers it when they come out.",
  "That's a good question, and I'd rather get it right than guess. I'll flag it for the engineer.",
];

export function safeFallback(seed: number): string {
  return SAFE_FALLBACKS[seed % SAFE_FALLBACKS.length] as string;
}
