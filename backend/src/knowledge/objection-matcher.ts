/**
 * Objection matcher.
 *
 * Maps a prospect utterance to at most one catalogue entry. Deterministic and
 * local — no model call — so it costs nothing on the critical path and behaves
 * identically every run, which is what makes it testable.
 *
 * Classification is driven by the *current stage*, not the wording: the same
 * "just send me an email" is an A.I.R. smokescreen during the opening and a
 * real request to capture after the pitch (objection-handling.md).
 */
import { EARLY_STAGES, type ObjectionClass, type Stage } from '../types/domain.js';
import { OBJECTION_CATALOGUE, type ObjectionEntry } from './objection-catalogue.js';

export interface ObjectionMatch {
  entry: ObjectionEntry;
  score: number;
  matched: string[];
}

/** Below this, treat the turn as ordinary conversation rather than an objection. */
const MIN_SCORE = 3;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'$\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack);
}

/**
 * Which class of objection applies at this point in the call.
 * Early = before solar has been mentioned; late = after the pitch.
 */
export function objectionClassForStage(stage: Stage, returnStage: Stage | null): ObjectionClass {
  const effective = stage === 'objection_handling' ? (returnStage ?? 'opening') : stage;
  return EARLY_STAGES.includes(effective) ? 'early' : 'late';
}

/**
 * Finds the best matching objection for an utterance at a given stage.
 * Returns null when nothing clears the threshold.
 */
export function matchObjection(
  utterance: string,
  stage: Stage,
  returnStage: Stage | null = null,
): ObjectionMatch | null {
  const text = normalize(utterance);
  if (text.length === 0) return null;

  const wantedClass = objectionClassForStage(stage, returnStage);
  let best: ObjectionMatch | null = null;

  for (const entry of OBJECTION_CATALOGUE) {
    let score = 0;
    const matched: string[] = [];

    for (const phrase of entry.phrases) {
      const p = normalize(phrase);
      if (p.length > 0 && text.includes(p)) {
        // Longer phrases are far more specific than short ones: "not the
        // homeowner" should beat a stray "own".
        score += 3 + Math.min(p.split(' ').length, 4);
        matched.push(phrase);
      }
    }

    for (const keyword of entry.keywords ?? []) {
      if (hasWord(text, normalize(keyword))) {
        score += 2;
        matched.push(keyword);
      }
    }

    if (score === 0) continue;

    // Same-class entries are strongly preferred, but a late-stage objection
    // raised early (or vice versa) can still win on a much stronger match —
    // a prospect can say "I rent" during the opening, and that is a real DQ.
    if (entry.objectionClass !== wantedClass) score -= 4;

    if (score >= MIN_SCORE && (best === null || score > best.score)) {
      best = { entry, score, matched };
    }
  }

  return best;
}

/**
 * Detects an unconditional stop request.
 *
 * Checked before objection matching and before anything else in the turn
 * pipeline: fallback-responses.md §4 makes this immediate and non-negotiable —
 * no A.I.R., no rebuttal, no retention attempt.
 */
export function detectDoNotContact(utterance: string): boolean {
  const text = normalize(utterance);
  const patterns = [
    'do not call',
    "don't call",
    'stop calling',
    'take me off',
    'remove me from',
    'do not contact',
    "don't contact",
    'do not call list',
    'never call',
    'lose my number',
    'quit calling',
    'unsubscribe',
  ];
  return patterns.some((p) => text.includes(p));
}

/** Detects hostility that warrants one de-escalation and a close. */
export function detectHostility(utterance: string): boolean {
  const text = normalize(utterance);
  const patterns = [
    'fuck',
    'shit',
    'asshole',
    'scumbag',
    'piss off',
    'go to hell',
    'shut up',
    'sue you',
  ];
  return patterns.some((p) => text.includes(p));
}
