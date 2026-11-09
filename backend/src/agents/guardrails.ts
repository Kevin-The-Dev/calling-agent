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
  // knowledge base describes no such arrangement. Caught three times in E2E
  // testing: "PG&E is one of our partner providers", "one of the providers we
  // work with", and — straight through an earlier, tighter version of this
  // rule — "that's one of the most common providers we work with". Anchoring on
  // the exact words between "the" and "providers" was the mistake; the claim is
  // the noun and the verb, and anything may sit between them.
  {
    pattern:
      /\b(?:providers?|utilit(?:y|ies)|power compan(?:y|ies)|compan(?:y|ies))\b[^.?!]{0,24}\bwe (?:work|partner|deal) with\b/i,
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
  // Only the internal identifiers. An earlier version also blocked the bare
  // words "opening", "rapport" and "qualification", which are ordinary English
  // and turn up in exactly the replies that matter most: "I have an opening
  // Thursday at two" during booking, or "the qualification is quick". Every one
  // of those was discarded and replaced with the "I'm not 100% sure" fallback,
  // mid-booking, for no reason the prospect could make sense of.
  {
    pattern: /\b(?:need_discovery|value_pitch|objection_handling|objection[_ ]handling)\b/i,
    rule: 'reveals_stage',
  },
  // The phrasing that actually leaks the machine, rather than the vocabulary.
  {
    pattern: /\b(?:current|next|this|the) (?:conversation )?stage\b|\bmove(?:d|s)? (?:me |us )?to the \w+ stage\b/i,
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

/**
 * Assistant-speak.
 *
 * None of these is a lie or a policy breach, which is why the prompt alone
 * never fully removed them — the model has no reason to think "I'd be happy to
 * help with that" is wrong. On a phone call it is the giveaway: a setter working
 * a neighborhood does not talk like a help desk, and the moment one of these
 * lands the prospect knows they are talking to software.
 *
 * Stripped rather than blocked. The rest of the reply is usually fine, and
 * discarding it would cost a real turn to remove a stock phrase.
 */
const CHATBOT_TELLS: RegExp[] = [
  /\b(?:certainly|absolutely|of course)[,!]?\s*i(?:'d| would)\s+be\s+(?:happy|glad|delighted)\s+to\b[^.!?]*[.!?]/gi,
  /\bi(?:'d| would)\s+be\s+(?:happy|glad|delighted)\s+to\s+(?:help|assist)\b[^.!?]*[.!?]/gi,
  /\bhow (?:can|may) i (?:assist|help)(?: you)?(?: today)?\s*\?/gi,
  /\bis there anything else i can (?:help|assist)[^.!?]*[?.!]/gi,
  /\bi(?:'m| am) here to (?:help|assist)\b[^.!?]*[.!?]/gi,
  /\bi hope (?:this|that) helps\b[^.!?]*[.!?]/gi,
  /\b(?:please )?feel free to (?:ask|reach out|let me know)\b[^.!?]*[.!?]/gi,
  /\bthank you for (?:your |the |that )?(?:question|inquiry|enquiry|information|interest)\b[^.!?]*[.!?]/gi,
  /\bi understand your concern\b[^.!?]*[.!?]/gi,
];

/**
 * Words a person on a phone does not use, and what they say instead.
 *
 * Rewritten rather than blocked, because the sentence around them is usually
 * fine and discarding a whole turn to remove one word costs a real exchange.
 *
 * "Chat" is the one that matters. Nobody cold-calling a street says "is this a
 * good time to chat" — that is chat-window vocabulary, and hearing it out loud
 * is the moment the prospect works out what they are talking to. The prompt asks
 * for all of this too; the prompt is persuasion and this is the enforcement.
 */
const SPOKEN_SUBSTITUTIONS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\bchit-?chat\b/gi, replacement: 'talk' },
  { pattern: /\bchatting\b/gi, replacement: 'talking' },
  { pattern: /\bchatted\b/gi, replacement: 'spoke' },
  // "a quick chat" / "a brief chat" → "a quick word", which is what is meant.
  { pattern: /\ba (quick|brief|short|little) chat\b/gi, replacement: 'a $1 word' },
  { pattern: /\bchats\b/gi, replacement: 'talks' },
  { pattern: /\bchat\b/gi, replacement: 'talk' },
  { pattern: /\bassist you\b/gi, replacement: 'help you' },
  { pattern: /\bhow may I\b/gi, replacement: 'how can I' },
];

/**
 * Asking to be allowed to carry on.
 *
 * The script never does this — a setter working a neighbourhood opens by saying
 * why they are there, not by requesting an audience. Every one of these hands
 * the prospect a one-word way to end the call before anything has been said,
 * and "sorry to bother you" concedes that the call is a nuisance in the first
 * sentence. Dropped whole, since what follows them still stands on its own.
 */
const PERMISSION_ASKS: RegExp[] = [
  /\b(?:is|would) (?:this|now) (?:be )?a (?:good|bad|convenient) time\b[^.!?]*[.!?]/gi,
  /\bdo you have (?:a|just a|got a) (?:quick )?(?:minute|moment|second|sec)\b[^.!?]*[.!?]/gi,
  /\b(?:have you got|got) a (?:quick )?(?:minute|moment|second|sec)\b[^.!?]*[.!?]/gi,
  /\b(?:i'?m |i am )?sorry (?:to|for) (?:bother|bothering|disturb|disturbing|trouble|troubling)(?: you)?\b[^.!?]*[.!?]/gi,
  /\b(?:can|could|may) i (?:steal|borrow|take) (?:a|just a) (?:minute|moment|few minutes|second)\b[^.!?]*[.!?]/gi,
  /\bdo you mind if i ask\b[^.!?]*[?]/gi,
];

/** Removes stock assistant phrasing. Returns the text and whether anything went. */
function stripChatbotTells(text: string): { text: string; stripped: boolean } {
  let out = text;
  for (const pattern of CHATBOT_TELLS) {
    // The patterns are global, so lastIndex has to be reset between calls.
    pattern.lastIndex = 0;
    out = out.replace(pattern, ' ');
  }

  for (const pattern of PERMISSION_ASKS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, ' ');
  }

  for (const { pattern, replacement } of SPOKEN_SUBSTITUTIONS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, replacement);
  }

  // A dropped sentence can leave the leftover punctuation of the one before it.
  out = out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[\s,;:—-]+/, '')
    .trim();

  return { text: out, stripped: out !== text };
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
 * An unfilled mail-merge placeholder.
 *
 * Caught in end-to-end testing: with no name known, the model opened the call
 * with "Hi there, is this [Homeowner's Name]?" — spoken aloud, brackets and
 * all. Every word generated here goes straight to the speaker, so a template
 * token is not a cosmetic defect; it is the first thing the prospect hears and
 * it identifies the caller as a machine reading a form.
 *
 * Matches a bracketed or braced span of template-ish words. Ordinary asides
 * ("we can do that (if you like)") use parentheses and are untouched.
 */
const PLACEHOLDER_PATTERN = /[[{][^\]}\n]{2,40}[\]}]/;

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

  const tells = stripChatbotTells(text);
  if (tells.stripped) {
    text = tells.text;
    violations.push({
      rule: 'assistant_phrasing',
      detail: 'Reply used stock assistant phrasing; removed before speaking.',
      severity: 'rewrite',
    });
  }

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

  if (PLACEHOLDER_PATTERN.test(text)) {
    violations.push({
      rule: 'unfilled_placeholder',
      detail: 'Reply contained a template placeholder that would be spoken aloud.',
      severity: 'block',
    });
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

/**
 * Replies used when the model produced nothing at all — an error or a timeout
 * (fallback-responses.md §5).
 *
 * Distinct from `SAFE_FALLBACKS` on purpose. Those say "I'm not sure about
 * that", which is right when a claim was blocked and nonsense as the answer to
 * "I'm Kevin" — and a model outage made the agent say it to every single
 * thing the prospect said. Asking them to say it again is what a person does
 * when the line breaks up, and it keeps the conversation where it was.
 */
const TECHNICAL_FALLBACKS = [
  'Sorry, you cut out for a second there. Could you say that one more time?',
  'Sorry about that, the line went quiet on my end. What was that?',
  'Apologies, I missed the last bit. Could you repeat that for me?',
];

export function technicalFallback(seed: number): string {
  return TECHNICAL_FALLBACKS[seed % TECHNICAL_FALLBACKS.length] as string;
}
