/**
 * Echo guard — stops the agent answering its own voice.
 *
 * The browser voice stack (decision D8) plays the agent through the OS speech
 * engine, outside the page's audio graph, so the microphone's echo cancellation
 * has no reference signal to subtract. If any of that audio reaches speech
 * recognition, it comes back as a "prospect" turn that is the agent's own
 * question, and the agent dutifully answers it — then asks again, and again.
 *
 * The client closes the microphone for the whole agent turn, which prevents
 * almost all of it. This is the authoritative backstop: the server holds the
 * exact text the agent just said, so it is the one place that can say with
 * certainty "the prospect did not say this".
 *
 * Two outcomes beyond "clean":
 *
 *   - echo     the utterance is (nearly) all agent speech → ignore the turn.
 *   - stripped the utterance opens with agent speech and then the prospect's
 *              real answer ("…are you the owner of the property yes I am")
 *              → keep only the answer.
 */

/**
 * Shortest utterance the guard will treat as an echo.
 *
 * Below four words a phrase is too generic to attribute — "yes", "PG and E",
 * "about two hundred" — and both sides plausibly said it. Dropping a real
 * answer stalls the call, so short utterances always pass.
 */
export const ECHO_MIN_WORDS = 4;

/**
 * Share of the utterance's words that must appear, in order, in the agent's
 * recent speech for the whole utterance to count as an echo.
 *
 * Recognition of synthesized speech is close to verbatim but not exact — a
 * dropped "the", "you're" heard as "your". 0.8 absorbs that while leaving a
 * prospect who quotes the question back and then answers it ("am I the owner?
 * yes I am") well below the line.
 */
export const ECHO_MATCH_RATIO = 0.8;

export type EchoVerdict =
  | { kind: 'clean'; utterance: string }
  | { kind: 'stripped'; utterance: string }
  | { kind: 'echo' };

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Length of the longest common subsequence of two word lists. */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  // Single rolling row: utterances are short and replies are a few sentences,
  // so this is a few thousand cells at most.
  const row = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0;
      row[j] = word === b[j - 1] ? diagonal + 1 : Math.max(above, row[j - 1] ?? 0);
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

/** True when `needle` occurs as a contiguous run inside `haystack`. */
function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Classifies a prospect utterance against what the agent recently said.
 *
 * @param utterance  the transcript the client sent as the prospect's turn
 * @param agentSpeech the agent's most recent replies, oldest first. Passing the
 *   whole reply rather than single sentences matters: an echo routinely spans a
 *   sentence boundary ("Nice to meet you. And are you the owner…").
 */
export function checkEcho(utterance: string, agentSpeech: readonly string[]): EchoVerdict {
  const words = normalizeWords(utterance);
  const reference = normalizeWords(agentSpeech.join(' '));

  if (words.length < ECHO_MIN_WORDS || reference.length === 0) {
    return { kind: 'clean', utterance };
  }

  if (lcsLength(words, reference) / words.length >= ECHO_MATCH_RATIO) {
    return { kind: 'echo' };
  }

  // The tail of the agent's voice followed by the prospect's real answer.
  // Find the longest leading run that the agent said verbatim and drop it.
  for (let k = words.length - 1; k >= ECHO_MIN_WORDS; k -= 1) {
    if (containsRun(reference, words.slice(0, k))) {
      return { kind: 'stripped', utterance: stripLeadingWords(utterance, k) };
    }
  }

  return { kind: 'clean', utterance };
}

/**
 * Removes the first `count` words from the original text, keeping the rest
 * exactly as recognition produced it (case, punctuation).
 */
function stripLeadingWords(text: string, count: number): string {
  let seen = 0;
  const tokens = text.trim().split(/\s+/);
  let index = 0;
  while (index < tokens.length && seen < count) {
    // Counted the way `normalizeWords` counts: "—" is no word, "PG&E" is two.
    seen += normalizeWords(tokens[index] ?? '').length;
    index += 1;
  }
  return tokens.slice(index).join(' ');
}
