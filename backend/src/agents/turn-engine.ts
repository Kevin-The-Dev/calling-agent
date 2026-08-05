/**
 * The turn engine.
 *
 * One prospect utterance in, one spoken agent reply out, plus the state changes
 * that fall out of it.
 *
 * The shape is driven entirely by latency (implementation.md §1.3). Two model
 * calls run concurrently:
 *
 *   - the conversational call streams, and each completed sentence is handed
 *     to text-to-speech immediately, so the prospect hears speech ~870ms after
 *     they stop talking rather than after the full reply is generated;
 *   - the extractor call produces structured state and is awaited only at the
 *     end of the turn, off the critical path.
 *
 * Guardrails run per sentence rather than on the finished reply — a blocked
 * claim must never reach the speaker, and by the time the reply is complete the
 * first sentence has already been spoken.
 */
import type { Env } from '../lib/env.js';
import { createLogger } from '../lib/logger.js';
import type { AgentIdentity } from '../knowledge/prompt-builder.js';
import { buildExtractorPrompt, buildSystemPrompt } from '../knowledge/prompt-builder.js';
import {
  detectDoNotContact,
  detectHostility,
  matchObjection,
} from '../knowledge/objection-matcher.js';
import type { LlmProvider, LlmMessage } from '../services/llm/index.js';
import {
  extractionSchema,
  type CallState,
  type Extraction,
  type ObjectionRecord,
  type Stage,
  type TranscriptTurn,
} from '../types/domain.js';
import { applyGuardrails, safeFallback, type GuardrailViolation } from './guardrails.js';
import { scoreLead } from './scoring.js';
import { nextStage, resolveOutcome } from './state-machine.js';

/** JSON Schema handed to the extractor model. */
const EXTRACTION_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    lead_patch: {
      type: 'object',
      description: 'Only fields learned in THIS exchange. Omit anything not stated.',
      properties: {
        name: { type: 'string', description: "The prospect's own name, first name alone is fine." },
        phone: {
          type: 'string',
          description: 'Their contact number, digits only, however they spoke it.',
        },
        email: { type: 'string', description: 'Their email address, lowercased.' },
        address: { type: 'string', description: 'The property address, partial is fine.' },
        homeowner_confirmed: { type: 'boolean' },
        home_type: {
          type: 'string',
          enum: ['single_family', 'condo', 'townhome', 'mobile', 'other', 'unknown'],
        },
        owns_roof: { type: 'boolean' },
        monthly_bill: { type: 'number' },
        utility_provider: { type: 'string' },
        roof_type: { type: 'string' },
        shading: { type: 'string', enum: ['none', 'partial', 'major', 'unknown'] },
        credit_score_band: {
          type: 'string',
          enum: ['above_650', 'below_650', 'unsure', 'declined'],
        },
        already_has_solar: { type: 'boolean' },
        moving_timeline_months: { type: 'number' },
        has_tenant: { type: 'boolean' },
        decision_makers: {
          type: 'array',
          description:
            'Everyone who must be part of the decision. If the prospect says it is just them, ' +
            'record one entry for the prospect with relationship "self" — never leave it empty ' +
            'once they have answered.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              relationship: { type: 'string' },
              will_attend: { type: 'boolean' },
            },
            required: ['name'],
          },
        },
        pain_points: { type: 'array', items: { type: 'string' } },
      },
    },
    proposed_stage: {
      type: 'string',
      enum: [
        'opening',
        'rapport',
        'qualification',
        'need_discovery',
        'value_pitch',
        'appointment',
        'confirmation',
        'closing',
      ],
      description: 'The stage the conversation should move to next, or the current one.',
    },
    buying_intent: { type: 'string', enum: ['low', 'medium', 'high'] },
    requests_do_not_contact: { type: 'boolean' },
    prospect_ended_call: { type: 'boolean' },
  },
  required: ['lead_patch'],
};

export interface TurnInput {
  state: CallState;
  utterance: string;
  history: TranscriptTurn[];
  identity: AgentIdentity;
}

export interface TurnOutput {
  /** Sentences in order, as they become speakable. */
  sentences: AsyncIterable<string>;
  /** Resolves once the reply is complete and all state has been folded in. */
  result: Promise<TurnResult>;
}

export interface TurnResult {
  reply: string;
  state: CallState;
  violations: GuardrailViolation[];
  usedFallback: boolean;
  objectionId: string | null;
  latencyToFirstTokenMs: number;
  tokensIn: number;
  tokensOut: number;
}

/** Recent turns, oldest first, capped to keep the prompt small. */
function toMessages(history: TranscriptTurn[], utterance: string, limit = 8): LlmMessage[] {
  const recent = history.slice(-limit);
  const messages: LlmMessage[] = recent
    .filter((t) => t.speaker !== 'system')
    .map((t) => ({
      role: t.speaker === 'agent' ? ('assistant' as const) : ('user' as const),
      content: t.content,
    }));

  messages.push({ role: 'user', content: utterance });

  // Anthropic-style APIs reject a leading assistant message.
  while (messages.length > 0 && messages[0]?.role === 'assistant') messages.shift();
  return messages;
}

/**
 * Splits a growing buffer into complete sentences.
 * Returns the sentences ready to speak and whatever remains unterminated.
 */
function drainSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;

  for (;;) {
    // A sentence end followed by whitespace. Avoids splitting "$1,200." or
    // "Mr. Smith" mid-number/abbreviation by requiring a following space.
    const match = /[.!?]["')\]]?\s/.exec(rest);
    if (!match) break;

    const end = match.index + match[0].length;
    const sentence = rest.slice(0, end).trim();
    if (sentence.length > 0) sentences.push(sentence);
    rest = rest.slice(end);
  }

  return { sentences, rest };
}

export function runTurn(
  env: Env,
  provider: LlmProvider,
  input: TurnInput,
): TurnOutput {
  const { state, utterance, history, identity } = input;
  const logger = createLogger(env.LOG_LEVEL, { component: 'turn-engine', callId: state.callId });
  const startedAt = Date.now();

  // ── Pre-flight detection, before any model call ──────────────────────────
  // These are deterministic and must not depend on the model noticing them.
  const doNotContact = detectDoNotContact(utterance);
  const hostile = detectHostility(utterance);
  const objection = doNotContact ? null : matchObjection(utterance, state.stage, state.returnStage);

  // The generator always resolves this — generation failures fall back to a
  // safe line rather than rejecting, so a broken turn never breaks the call.
  let resolveResult: (r: TurnResult) => void;
  const result = new Promise<TurnResult>((resolve) => {
    resolveResult = resolve;
  });

  async function* generate(): AsyncGenerator<string> {
    // A removal request short-circuits everything: no model call, no objection
    // handling, no retention attempt (fallback-responses.md §4).
    if (doNotContact) {
      const line =
        "Absolutely — I'll take you off the list right now. Sorry to have bothered you. Have a good day.";
      yield line;
      resolveResult(finish(line, [], false, null, Date.now() - startedAt, 0, 0, true, false));
      return;
    }

    if (hostile) {
      const line = "Understood — I'll leave you to it. Have a good day.";
      yield line;
      resolveResult(finish(line, [], false, null, Date.now() - startedAt, 0, 0, false, true));
      return;
    }

    const systemPrompt = buildSystemPrompt({ state, identity, objection });

    // Fire the extractor now so it runs alongside generation rather than after.
    const extractionPromise = extract(provider, state, utterance, history).catch(
      (err: unknown) => {
        logger.warn('extraction_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      },
    );

    const violations: GuardrailViolation[] = [];
    let spoken = '';
    let blocked = false;
    let firstTokenAt = 0;
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const stream = await provider.streamText({
        system: systemPrompt,
        messages: toMessages(history, utterance),
        maxTokens: env.LLM_MAX_TOKENS,
        temperature: env.LLM_TEMPERATURE,
      });

      let buffer = '';
      // The closing recap legitimately covers five points, so the
      // one-question rule is relaxed there and only there.
      const enforceOneQuestion = state.stage !== 'closing';

      for await (const chunk of stream.chunks) {
        if (firstTokenAt === 0) firstTokenAt = Date.now() - startedAt;
        buffer += chunk;

        const { sentences, rest } = drainSentences(buffer);
        buffer = rest;

        for (const sentence of sentences) {
          const checked = applyGuardrails(sentence, { enforceOneQuestion });
          violations.push(...checked.violations);

          if (checked.blocked) {
            // Stop generating immediately — do not let the rest of a reply
            // containing a forbidden claim reach the prospect.
            blocked = true;
            break;
          }
          if (checked.text.length > 0) {
            spoken += (spoken ? ' ' : '') + checked.text;
            yield checked.text;
          }
        }

        if (blocked) break;
      }

      // Whatever is left in the buffer at end-of-stream is the final sentence.
      if (!blocked && buffer.trim().length > 0) {
        const checked = applyGuardrails(buffer, { enforceOneQuestion });
        violations.push(...checked.violations);
        if (checked.blocked) blocked = true;
        else if (checked.text.length > 0) {
          spoken += (spoken ? ' ' : '') + checked.text;
          yield checked.text;
        }
      }

      const usage = await stream.usage;
      tokensIn = usage.inputTokens;
      tokensOut = usage.outputTokens;
    } catch (err) {
      logger.error('generation_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      blocked = true;
    }

    let usedFallback = false;
    if (blocked || spoken.trim().length === 0) {
      // Something was refused or the model failed. Say something safe rather
      // than saying nothing — dead air ends calls.
      usedFallback = true;
      const line = safeFallback(state.turnCount);
      spoken = spoken.trim().length > 0 ? spoken : line;
      if (spoken === line) yield line;
      logger.warn('turn_fell_back', {
        rules: violations.filter((v) => v.severity === 'block').map((v) => v.rule),
      });
    }

    const extraction = await extractionPromise;
    resolveResult(
      finish(
        spoken,
        violations,
        usedFallback,
        objection?.entry.id ?? null,
        firstTokenAt,
        tokensIn,
        tokensOut,
        false,
        false,
        extraction,
      ),
    );
  }

  /** Folds the turn's outcome into a new immutable CallState. */
  function finish(
    reply: string,
    violations: GuardrailViolation[],
    usedFallback: boolean,
    objectionId: string | null,
    latencyToFirstTokenMs: number,
    tokensIn: number,
    tokensOut: number,
    forceDnc: boolean,
    forceHostile: boolean,
    extraction?: Extraction | null,
  ): TurnResult {
    const patch = extraction?.lead_patch ?? {};
    const lead = { ...state.lead, ...stripEmpty(patch) };

    const buyingIntent = extraction?.buying_intent ?? state.buyingIntent;
    const scored = scoreLead(lead, buyingIntent);

    const isEarly = objection?.entry.objectionClass === 'early';
    const earlyObjectionCount = state.earlyObjectionCount + (isEarly ? 1 : 0);
    const lateObjectionCount =
      state.lateObjectionCount + (objection && !isEarly ? 1 : 0);

    const interim: CallState = {
      ...state,
      lead,
      qualificationScore: scored.score,
      qualificationBand: scored.band,
      buyingIntent,
      earlyObjectionCount,
      lateObjectionCount,
    };

    const transition = nextStage(interim, {
      proposedStage: (extraction?.proposed_stage as Stage | undefined) ?? null,
      hasObjection: objection !== null,
      doNotContact: forceDnc || extraction?.requests_do_not_contact === true,
      prospectEndedCall: forceHostile || extraction?.prospect_ended_call === true,
      maxAirCycles: env.MAX_AIR_CYCLES,
    });

    const objections: ObjectionRecord[] = objection
      ? [
          ...state.objections,
          {
            id: objection.entry.id,
            objectionClass: objection.entry.objectionClass,
            quote: utterance,
            stageAt: state.stage,
            resolved: true,
          },
        ]
      : state.objections;

    const newState: CallState = {
      ...interim,
      stage: transition.stage,
      returnStage: transition.returnStage,
      turnCount: state.turnCount + 1,
      consecutiveFallbacks: usedFallback ? state.consecutiveFallbacks + 1 : 0,
      objections,
      disqualifiedReason: scored.disqualifiedReason,
      doNotContact: state.doNotContact || forceDnc || extraction?.requests_do_not_contact === true,
      outcome: null,
    };

    newState.outcome = resolveOutcome(newState, transition.reason);

    if (transition.rejectedProposal) {
      logger.info('stage_proposal_rejected', {
        from: state.stage,
        proposed: transition.rejectedProposal,
        applied: transition.stage,
      });
    }

    return {
      reply,
      state: newState,
      violations,
      usedFallback,
      objectionId,
      latencyToFirstTokenMs,
      tokensIn,
      tokensOut,
    };
  }

  return { sentences: generate(), result };
}

/** Drops null/undefined/empty values so a patch never erases known data. */
function stripEmpty<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

async function extract(
  provider: LlmProvider,
  state: CallState,
  utterance: string,
  history: TranscriptTurn[],
): Promise<Extraction> {
  const lastAgentTurn = [...history].reverse().find((t) => t.speaker === 'agent');

  const { data } = await provider.extract<Extraction>({
    system: buildExtractorPrompt(state),
    messages: [
      {
        role: 'user',
        content: `Agent said: ${lastAgentTurn?.content ?? '(start of call)'}\nProspect replied: ${utterance}`,
      },
    ],
    schema: EXTRACTION_TOOL_SCHEMA,
    toolName: 'record_extraction',
    toolDescription: 'Record what was learned about the lead in this exchange.',
    parse: (raw) => extractionSchema.parse(raw),
  });

  return data;
}
