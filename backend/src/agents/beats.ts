/**
 * Which required beats the agent has actually delivered.
 *
 * Two beats in the script are *content*, not questions, and the state machine
 * had no way to tell whether either had happened. Both went missing in
 * end-to-end testing:
 *
 *   - **Rapport** advanced on turn count alone. The agent asked about the letter
 *     and the stage moved on, so the good-news/bad-news framing and the SGIP
 *     introduction — the entire reason the prospect is meant to keep listening —
 *     were simply never said. The call went straight from "did you get a letter"
 *     to asking about the bill, with nothing explaining why.
 *
 *   - **The bill swap** advanced after a single turn in `value_pitch`, whether or
 *     not the pitch had been given. Caught skipping it altogether: the agent
 *     finished qualifying and proposed an appointment in the same breath, so the
 *     prospect was asked to book a visit having never been told what the visit
 *     was about.
 *
 * A question the agent forgets to ask leaves a hole in the lead record and the
 * completeness gate catches it. A statement the agent forgets to make leaves no
 * trace at all — which is exactly why it needs one.
 *
 * Read off what was actually spoken rather than tracked as a flag the model
 * sets, for the same reason the qualification score is computed server-side: the
 * model's account of what it said is not evidence that it said it.
 */
import type { DeliveredBeats, TranscriptTurn } from '../types/domain.js';

export type { DeliveredBeats };

export const NO_BEATS: DeliveredBeats = {
  sgip: false,
  pitch: false,
  phoneAsked: false,
  emailAsked: false,
  recap: false,
};

/**
 * The closing recap's points (sales-script §8), as they are actually said.
 * One definition, used both to end a short call on the recap and to decide at
 * close whether the appointment counts as booked.
 */
export function recapPoints(
  spoken: string,
  address?: string | null,
): {
  recap_details_given: boolean;
  reminded_confirmation_call: boolean;
  reminded_utility_bill: boolean;
  reminded_decision_makers: boolean;
  reminded_no_cost: boolean;
} {
  const text = spoken.toLowerCase();
  // The address's leading word — "123" of "123 Maple Street" — said back in
  // the close is the recap restating the details, however it was introduced.
  const addressKey = address?.trim().split(/\s+/)[0]?.toLowerCase();
  const restatesAddress =
    addressKey !== undefined && addressKey.length >= 2 && text.includes(addressKey);

  return {
    recap_details_given:
      restatesAddress ||
      /\b(?:recap|go over|run through|so we(?:'re| are) on the same page|just to (?:confirm|make sure))\b/.test(text),
    reminded_confirmation_call: /\bcall (?:you )?(?:before|ahead|first)|before (?:he|she|they|heading)/.test(text),
    reminded_utility_bill:
      /\b(?:electric(?:ity)? |pg&e |power )?bill (?:ready|handy|on hand|nearby)|have (?:your|a copy of your) .{0,20}bill\b/.test(text),
    // Said naturally it names them: "make sure you and Priya are both there".
    reminded_decision_makers:
      /\bdecision makers?\b|\b(?:everyone|anyone)(?: else)? (?:who|that) .{0,30}deci(?:d|sion)|\ball .{0,20}present\b|\b(?:both|all of you|everyone) .{0,25}\b(?:there|present|home)\b|\byou and \w+ .{0,25}\b(?:there|present|home)\b/.test(
        text,
      ),
    reminded_no_cost: /\bnothing out of pocket\b|\bno (?:cost|charge)\b|\bnot cost(?:ing)? you\b/.test(text),
  };
}

/** The four reminders — what makes a booking hold — all in one reply. */
function deliversRecap(reply: string): boolean {
  const p = recapPoints(reply);
  return (
    p.reminded_confirmation_call &&
    p.reminded_utility_bill &&
    p.reminded_decision_makers &&
    p.reminded_no_cost
  );
}

/**
 * The agent asked for a number: a phone word followed, in the same sentence, by
 * a question mark. "Number" alone is not enough — "what number is your bill
 * at?" is not a request for a phone number.
 */
const PHONE_ASK_PATTERN =
  /\b(?:phone|cell|mobile|best number|number (?:to|where|for|i can|we can)|reach you)\b[^.!?]*\?/i;

/** The agent asked for an email address, in a question. */
const EMAIL_ASK_PATTERN = /\be-?mail\b[^.!?]*\?/i;

/**
 * The program, however the agent chose to word it.
 * The acronym alone is not enough — "the Self-Generation Incentive Program"
 * spelled out is the better delivery and the one the script actually writes.
 */
const SGIP_PATTERN = /\bS\.?G\.?I\.?P\b|\bself[-\s]?generation incentive\b/i;

/**
 * The bill swap.
 *
 * Requires the mechanic, not the vocabulary: solar coming up in conversation is
 * not the pitch. The pitch is that the bill goes to zero and is replaced by an
 * equipment payment 20 to 50% cheaper than what they pay now. Any one of these
 * phrasings means the prospect has heard the actual proposition.
 */
const PITCH_PATTERNS: RegExp[] = [
  /\b20\s*(?:to|-|–)\s*50\s*(?:%|percent)/i,
  /\breduce (?:that|your|the) bill (?:down )?to (?:zero|nothing)\b/i,
  /\b(?:bill|payment) (?:down )?to zero\b/i,
  /\ball you(?:'d| would)? be paying for is the (?:solar )?equipment\b/i,
  /\bcheaper than (?:what )?you(?:'re| are) paying (?:now|right now|today)\b/i,
];

/** Whether one spoken reply delivered each beat. */
export function beatsInReply(reply: string): DeliveredBeats {
  return {
    sgip: SGIP_PATTERN.test(reply),
    pitch: PITCH_PATTERNS.some((pattern) => pattern.test(reply)),
    phoneAsked: PHONE_ASK_PATTERN.test(reply),
    emailAsked: EMAIL_ASK_PATTERN.test(reply),
    recap: deliversRecap(reply),
  };
}

/** Folds a new reply into what has already been delivered. Beats never un-deliver. */
export function mergeBeats(previous: DeliveredBeats, reply: string): DeliveredBeats {
  const found = beatsInReply(reply);
  return {
    sgip: previous.sgip || found.sgip,
    pitch: previous.pitch || found.pitch,
    phoneAsked: previous.phoneAsked || found.phoneAsked,
    emailAsked: previous.emailAsked || found.emailAsked,
    recap: previous.recap || found.recap,
  };
}

/**
 * Rebuilds the beats from the transcript.
 *
 * Used when state comes back from the database rather than the cache. Without
 * it a cache miss would re-open a beat the prospect has already sat through and
 * the agent would deliver the SGIP introduction twice.
 */
export function beatsFromHistory(history: TranscriptTurn[]): DeliveredBeats {
  return history
    .filter((turn) => turn.speaker === 'agent')
    .reduce<DeliveredBeats>((acc, turn) => mergeBeats(acc, turn.content), NO_BEATS);
}
