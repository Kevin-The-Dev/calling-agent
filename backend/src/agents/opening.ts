/**
 * The opening line.
 *
 * Written here rather than generated, for two reasons.
 *
 * **It is the one line that has to be right.** Someone decides in about three
 * seconds whether they are talking to a person. Left to the model, the opener
 * drifted into help-desk phrasing — "Hi there, sorry to bother you, is this a
 * good time to chat for a moment?" — which is an apology, a permission request
 * and the word "chat" in a single breath, and none of the three belong to a
 * setter working a neighbourhood. The script (`Solar_Sales_Script_v2.pdf` §1) is
 * specific about what this beat does: greet, say who you are, establish that you
 * are working *right there* for the next couple of weeks, and find out who you
 * have on the line. It never asks permission and it never apologises for calling.
 *
 * **It is the one turn with nothing to mask its latency.** Every later turn is
 * preceded by the prospect speaking; this one follows a button press into
 * silence, and the model costs ~1.5s of it. Saying a line we already know costs
 * nothing, so the agent speaks the instant the call connects.
 *
 * The variants exist so two calls in a row do not open identically. They differ
 * only in wording — every one of them hits the same four beats in the same
 * order, and none of them asks more than the one question the script asks.
 */
import type { AgentIdentity } from '../knowledge/prompt-builder.js';

/**
 * How the caller introduces themselves.
 * Falls back to a bare first name when no company is configured, rather than
 * inventing one — claude.md §5.
 */
function introduce(identity: AgentIdentity, connector: string): string {
  const name = identity.agentName?.trim();
  const company = identity.companyName?.trim();

  if (name && company) return `${name} ${connector} ${company}`;
  if (name) return name;
  if (company) return `calling from ${company}`;
  return 'one of the guys working in your area';
}

/**
 * The script's four beats, three ways.
 *
 * Beat 1 — a warm, ordinary greeting. Not "sorry to bother you".
 * Beat 2 — who is calling.
 * Beat 3 — "working right in the corner of your neighborhood… for the next
 *           couple of weeks". This is the whole premise of the call and the
 *           reason the prospect keeps listening; it is required, not flavour.
 * Beat 4 — one question, and it is who am I speaking with. Solar is not
 *           mentioned, savings are not mentioned, and nothing is asked for.
 */
const VARIANTS: ((who: string, area: string) => string)[] = [
  (who, area) =>
    `Hey, how's it going? This is ${who}. We're actually working right in the corner of your neighborhood${area}, we'll be out here for the next couple of weeks. Who am I speaking with?`,

  (who, area) =>
    `Hey there, how are you doing today? It's ${who}. We've got a crew working right in the corner of your neighborhood${area} for the next couple of weeks. Sorry, who am I speaking with?`,

  (who, area) =>
    `Hi, how's your day going so far? This is ${who}. We're working right in the corner of your neighborhood${area} and we'll be around the next couple of weeks. Who do I have the pleasure of speaking with?`,
];

const CONNECTORS = ['over at', 'with', 'from'];

/**
 * Builds the line the agent speaks the moment the call connects.
 *
 * `seed` is injectable so tests are deterministic; in production it is random,
 * so consecutive calls do not open with the same sentence.
 */
export function openingLine(identity: AgentIdentity, seed = Math.random()): string {
  const index = Math.min(VARIANTS.length - 1, Math.floor(seed * VARIANTS.length));
  const build = VARIANTS[index] as (who: string, area: string) => string;
  const connector = CONNECTORS[index] as string;

  // Named only when it is configured, and only ever as a place — "here in
  // California" is context, not a claim about who they are or where they live.
  const area = identity.serviceArea?.trim() ? ` here in ${identity.serviceArea.trim()}` : '';

  return build(introduce(identity, connector), area);
}
