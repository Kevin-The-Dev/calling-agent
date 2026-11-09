/**
 * Contact details read straight off an utterance, without a model.
 *
 * The extractor model is the authority on what a prospect said, but it runs
 * alongside the reply rather than before it (turn-engine.ts — waiting on it
 * would add a second model call to every turn's silence). So the reply to "my
 * number is 510 555 1212" was written by a model whose prompt still said
 * "you do not have their phone number", and it asked for it again. When the
 * extractor failed outright, the number was lost from the lead entirely.
 *
 * Phone numbers and email addresses have a shape a regex can recognise with
 * near certainty, and they are exactly the details that make a lead
 * contactable. Reading them here closes both gaps: the reply is written
 * knowing them, and the lead keeps them even if extraction fails. Anything
 * the extractor does return still wins.
 */
import type { Lead } from '../types/domain.js';

export type QuickFacts = Pick<Lead, 'name' | 'phone' | 'email' | 'homeowner_confirmed'>;

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/**
 * A ten-digit North American number, spoken or typed in any grouping:
 * "510 555 1212", "(510) 555-1212", "five one oh, five five five…".
 * An eleventh leading 1 is dropped. Shorter runs are ignored — a bill amount
 * or a street number is never mistaken for a phone number.
 */
export function findPhone(utterance: string): string | null {
  const tokens = utterance.toLowerCase().match(/\+?[a-z]+|\d+|[^\sa-z\d]/g) ?? [];
  let run = '';
  let best: string | null = null;

  const close = () => {
    // A leading country code, or an "oh" that was a hesitation rather than a
    // digit ("oh, it's five one zero…").
    const digits = run.length === 11 && /^[01]/.test(run) ? run.slice(1) : run;
    if (digits.length === 10 && best === null) best = digits;
    run = '';
  };

  for (const token of tokens) {
    if (/^\d+$/.test(token)) run += token;
    else if (token in DIGIT_WORDS) run += DIGIT_WORDS[token];
    else if (/^[()\-.,+]$/.test(token)) continue; // separators inside a number
    else close();
  }
  close();

  if (best === null) return null;
  const n = best as string;
  return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
}

const TLD = '(?:com|net|org|edu|gov|io|co|us|me|ai|info|biz)';

/**
 * An email address, typed ("kevin@gmail.com") or spoken
 * ("kevin at gmail dot com", "k dot smith at yahoo dot com").
 */
export function findEmail(utterance: string): string | null {
  const typed = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i.exec(utterance);
  if (typed) return typed[0].toLowerCase();

  const spoken = new RegExp(
    `\\b([a-z0-9_-]+(?:\\s*(?:dot|\\.)\\s*[a-z0-9_-]+)*)\\s+at\\s+` +
      `([a-z0-9-]+(?:\\s*(?:dot|\\.)\\s*[a-z0-9-]+)*?\\s*(?:dot|\\.)\\s*${TLD})\\b`,
    'i',
  ).exec(utterance);
  if (!spoken) return null;

  const join = (part: string) => part.toLowerCase().replace(/\s*(?:dot|\.)\s*/g, '.').replace(/\s+/g, '');
  return `${join(spoken[1] ?? '')}@${join(spoken[2] ?? '')}`;
}

/** Words that follow "I'm" / "this is" without being a name. */
const NOT_NAMES = new Set([
  'good', 'fine', 'okay', 'ok', 'well', 'great', 'alright', 'all', 'doing', 'not', 'here',
  'sorry', 'busy', 'just', 'the', 'a', 'an', 'interested', 'sure', 'yes', 'yeah', 'no',
  'calling', 'driving', 'working', 'at', 'in', 'on', 'home', 'very', 'pretty', 'so',
  'actually', 'really', 'still', 'it', 'that', 'he', 'she', 'they', 'we', 'you', 'him', 'her',
  'owner', 'homeowner', 'renting', 'tenant', 'kind', 'kinda', 'retired', 'happy',
]);

/**
 * The prospect's first name when they introduce themselves outright —
 * "my name is Kevin", "this is Kevin", "I'm Kevin", "Kevin here".
 *
 * Deliberately narrow: recognition capitalizes proper names, so the word must
 * be capitalized, and anything that reads as a state ("I'm good") is refused.
 * A missed name costs one re-ask; a wrong one is spoken back to the prospect.
 */
export function findName(utterance: string): string | null {
  const patterns = [
    /\b(?:my name is|my name's|name's|the name is|call me)\s+([a-z][a-z-]+)/i,
    // The lead-in in either case, the name itself capitalized.
    /\b(?:[Tt]his is|[Ii]t's|[Ii] am|[Ii]'m|[Ii]m)\s+([A-Z][a-z-]+)\b/,
    /^\s*([A-Z][a-z-]+)\s+here\b/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(utterance);
    const word = match?.[1];
    if (!word || NOT_NAMES.has(word.toLowerCase())) continue;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return null;
}

/** The agent's last line asked whether they own the home. */
const OWNERSHIP_QUESTION = /\b(?:own(?:er)?|homeowner)\b[^.!?]*\?/i;

/** A plain yes to that question, or an outright statement of ownership. */
const OWNERSHIP_YES =
  /^(?:yes|yeah|yep|yup|correct|that's right|that is right|i do|we do|i am|sure do|sure)\b|\b(?:i|we) own (?:it|the (?:home|house|place|property))\b|\bi'?m the (?:home)?owner\b/i;

/** Hedges that turn a "yes" into something the extractor should judge. */
const OWNERSHIP_HEDGE = /\b(?:not|don't|dont|rent|renting|landlord|parents|my (?:mom|dad|mother|father)|tenant)\b/i;

/**
 * "Yes, I own it" in answer to the ownership question.
 *
 * Only ever the positive. Ownership is the opening's gate, and with the
 * extractor down a confirmed homeowner sat in the opening for the rest of the
 * call. A "no" is never inferred: it disqualifies, and that call belongs to the
 * extractor, which reads nuance ("my parents own it, I live here") that a
 * pattern cannot.
 */
export function findHomeownerYes(utterance: string, lastAgentReply: string | undefined): boolean {
  if (!lastAgentReply || !OWNERSHIP_QUESTION.test(lastAgentReply)) return false;
  const text = utterance.trim();
  return OWNERSHIP_YES.test(text) && !OWNERSHIP_HEDGE.test(text);
}

/** Everything this module can read from one utterance. Absent keys were not found. */
export function quickFacts(utterance: string, lastAgentReply?: string): QuickFacts {
  const facts: QuickFacts = {};
  const phone = findPhone(utterance);
  const email = findEmail(utterance);
  const name = findName(utterance);
  if (phone) facts.phone = phone;
  if (email) facts.email = email;
  if (name) facts.name = name;
  if (findHomeownerYes(utterance, lastAgentReply)) facts.homeowner_confirmed = true;
  return facts;
}

/**
 * Folds quick facts into a lead.
 *
 * A phone or email just spoken replaces an older one — the prospect is
 * correcting it. A name never replaces a known name: the pattern is far less
 * certain than a ten-digit number, and "this is Kevin's house" must not rename
 * the prospect mid-call.
 */
export function withQuickFacts(lead: Lead, facts: QuickFacts): Lead {
  const next: Lead = { ...lead };
  if (facts.phone) next.phone = facts.phone;
  if (facts.email) next.email = facts.email;
  if (facts.name && !lead.name) next.name = facts.name;
  if (facts.homeowner_confirmed && lead.homeowner_confirmed == null) next.homeowner_confirmed = true;
  return next;
}

// ─── Tidying what the prospect said ─────────────────────────────────────────
//
// Browser speech recognition writes down sounds, not intent: "kevin dot test at
// gmail dot com", "my name is kevin", "p g and e". Shown on screen and stored
// in the CRM that way, the transcript reads as broken and the lead record is
// hard to search. Each fix below is one the recognizer gets wrong all the time
// and that has exactly one correct reading.

/** Utility names as recognition hears them, and as they are written. */
const UTILITIES: [RegExp, string][] = [
  [/\bp\.?\s*g\.?\s*(?:and|&|n)\s*e\b\.?/gi, 'PG&E'],
  [/\bs\.?\s*d\.?\s*g\.?\s*(?:and|&|n)\s*e\b\.?/gi, 'SDG&E'],
  [/\bs\.?\s*c\.?\s*e\b\.?(?=\s|$|[,.!?])/gi, 'SCE'],
  [/\bsouthern california edison\b/gi, 'Southern California Edison'],
];

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/**
 * The utterance as it should be read: emails and phone numbers in their written
 * form, the prospect's name capitalized, utility names spelled properly.
 * Meaning is never changed — only how it is written down.
 */
export function cleanUtterance(utterance: string): string {
  let text = utterance.trim();

  // Spoken email → written email.
  const email = findEmail(text);
  if (email && !text.includes(email)) {
    text = text.replace(
      new RegExp(
        `\\b[a-z0-9_-]+(?:\\s*(?:dot|\\.)\\s*[a-z0-9_-]+)*\\s+at\\s+[a-z0-9-]+(?:\\s*(?:dot|\\.)\\s*[a-z0-9-]+)*?\\s*(?:dot|\\.)\\s*${TLD}\\b`,
        'i',
      ),
      email,
    );
  }

  // Ten-digit numbers in any grouping → 510-555-1212.
  text = text.replace(
    /(?<![\d-])(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?![\d-])/g,
    '$1-$2-$3',
  );

  // "my name is kevin" → "my name is Kevin". Only after phrases that can only
  // introduce a name — "I'm thinking" must not become "I'm Thinking".
  text = text.replace(
    /\b(my name is|my name's|name's|the name is|call me)\s+([a-z][a-z-]+)\b/gi,
    (whole, lead: string, word: string) =>
      NOT_NAMES.has(word.toLowerCase()) ? whole : `${lead} ${capitalize(word)}`,
  );

  for (const [pattern, written] of UTILITIES) text = text.replace(pattern, written);

  return text;
}

/** Ten digits as 510-555-1212; anything else left as it was. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : phone.trim();
}

/**
 * The lead record in one consistent written form, so the dashboard reads
 * cleanly and search finds "510-555-1212" whether the number was typed by the
 * extractor as digits or dashes.
 */
export function normalizeLead(lead: Lead): Lead {
  const next: Lead = { ...lead };
  if (next.name) {
    next.name = next.name
      .trim()
      .split(/\s+/)
      .map((part) => (part === part.toLowerCase() ? capitalize(part) : part))
      .join(' ');
  }
  if (next.phone) next.phone = formatPhone(next.phone);
  // Recognition writes addresses in lower case: "123 maple street san jose".
  // An address already written with capitals is left exactly as it is.
  if (next.address && next.address === next.address.toLowerCase()) {
    next.address = next.address
      .trim()
      .split(/\s+/)
      .map((part) => capitalize(part))
      .join(' ');
  }
  if (next.email) next.email = next.email.trim().toLowerCase().replace(/\s+/g, '');
  if (next.utility_provider) {
    let provider = next.utility_provider.trim();
    for (const [pattern, written] of UTILITIES) provider = provider.replace(pattern, written);
    next.utility_provider = provider;
  }
  return next;
}
