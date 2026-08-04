/**
 * Call routes — the conversational surface.
 *
 *   POST /api/calls            start a call, mint a call token
 *   POST /api/calls/:id/turn   one prospect utterance → streamed agent reply
 *   POST /api/calls/:id/end    finalize outcome and summary
 *
 * The turn endpoint streams Server-Sent Events. Streaming is not a nicety here:
 * the client speaks each sentence as it arrives, which is what keeps
 * end-of-speech to first-audio inside the latency budget.
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Env } from '../lib/env.js';
import { badRequest, notFound, toAppError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { signCallToken, verifyCallToken } from '../lib/call-token.js';
import { identityFromEnv } from '../knowledge/prompt-builder.js';
import { runTurn } from '../agents/turn-engine.js';
import { resolveFinalOutcome } from '../agents/state-machine.js';
import { createLlmProvider } from '../services/llm/index.js';
import {
  endCall,
  loadCallState,
  persistTurn,
  recordEvent,
  startCall,
} from '../services/calls.js';
import type { TranscriptTurn } from '../types/domain.js';
import { getServiceClient } from '../services/supabase.js';

const startSchema = z.object({
  consent: z.boolean(),
});

const turnSchema = z.object({
  utterance: z.string().trim().min(1, 'utterance must not be empty').max(2000),
});

/**
 * Sent by the client for the very first turn. The agent speaks first — a real
 * setter opens the call — so there is no prospect utterance to transcribe yet.
 */
const CALL_START_SENTINEL = '__call_started__';
const CALL_START_CUE = '(The call has just connected. Open the conversation.)';

/** Simple in-process rate limiter. Per-instance, which is enough to blunt abuse. */
const turnHits = new Map<string, number[]>();

function rateLimited(callId: string, perMinute: number): boolean {
  const now = Date.now();
  const window = now - 60_000;
  const hits = (turnHits.get(callId) ?? []).filter((t) => t > window);
  hits.push(now);
  turnHits.set(callId, hits);

  // Opportunistic cleanup so a long-lived instance does not grow unbounded.
  if (turnHits.size > 5000) {
    for (const [key, times] of turnHits) {
      if (times.every((t) => t <= window)) turnHits.delete(key);
    }
  }

  return hits.length > perMinute;
}

export function callRoutes(env: Env) {
  const app = new Hono();
  const logger = createLogger(env.LOG_LEVEL, { component: 'calls' });
  const provider = createLlmProvider(env);
  const identity = identityFromEnv(env);

  /** Start a call. */
  app.post('/calls', async (c) => {
    const body = startSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest('consent (boolean) is required');

    // R1: recording and transcription do not begin without explicit consent.
    if (!body.data.consent) throw badRequest('Consent is required before a call can start');

    const { callId, leadId } = await startCall(env, true);
    const token = await signCallToken(env.CALL_TOKEN_SECRET, {
      callId,
      leadId,
      expiresAt: Date.now() + env.CALL_TOKEN_TTL_SECONDS * 1000,
    });

    await recordEvent(env, callId, 'consent', { given: true });

    return c.json({
      callId,
      token,
      config: {
        sttLanguage: env.STT_PROVIDER === 'browser' ? 'en-US' : 'en-US',
        silenceTimeoutMs: env.SILENCE_TIMEOUT_MS,
        // The agent speaks first, exactly as a real setter would.
        greeting: true,
      },
    });
  });

  /** One conversational turn, streamed. */
  app.post('/calls/:id/turn', async (c) => {
    const callId = c.req.param('id');
    const token = c.req.header('X-Call-Token');
    if (!token) throw badRequest('Missing X-Call-Token header');

    const payload = await verifyCallToken(env.CALL_TOKEN_SECRET, token);
    if (payload.callId !== callId) throw badRequest('Call token does not match this call');

    if (rateLimited(callId, env.RATE_LIMIT_TURNS_PER_MIN)) {
      throw toAppError(new Error('rate limited'));
    }

    const parsed = turnSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid body');

    const state = await loadCallState(env, callId);
    if (!state) throw notFound('Call not found');

    const history = await loadHistory(env, callId);
    const previousStage = state.stage;

    const isCallStart = parsed.data.utterance === CALL_START_SENTINEL;
    const utterance = isCallStart ? CALL_START_CUE : parsed.data.utterance;

    const { sentences, result } = runTurn(env, provider, {
      state,
      utterance,
      history,
      identity,
    });

    return streamSSE(c, async (stream) => {
      try {
        for await (const sentence of sentences) {
          await stream.writeSSE({ event: 'sentence', data: JSON.stringify({ text: sentence }) });
        }

        const turn = await result;

        await persistTurn(env, {
          state: turn.state,
          // The opening turn has no prospect speech — record it as a system
          // marker so turn indices stay contiguous and the transcript reads
          // correctly in the dashboard.
          prospectUtterance: isCallStart ? '[call connected]' : utterance,
          agentReply: turn.reply,
          previousStage,
          latencyMs: turn.latencyToFirstTokenMs,
          tokensIn: turn.tokensIn,
          tokensOut: turn.tokensOut,
          objectionId: turn.objectionId,
          objectionQuote: turn.objectionId ? utterance : null,
        });

        if (turn.usedFallback) {
          await recordEvent(env, callId, 'fallback_used', {
            rules: turn.violations.map((v) => v.rule),
          });
        }
        if (turn.state.stage !== previousStage) {
          await recordEvent(env, callId, 'stage_change', {
            from: previousStage,
            to: turn.state.stage,
          });
        }

        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            stage: turn.state.stage,
            finished: turn.state.stage === 'ended' || turn.state.stage === 'disqualified',
            outcome: turn.state.outcome,
            latencyMs: turn.latencyToFirstTokenMs,
          }),
        });
      } catch (err) {
        const appError = toAppError(err);
        logger.error('turn_failed', { callId, code: appError.code, detail: appError.detail });
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify(appError.toResponseBody()),
        });
      }
    });
  });

  /** Finalize the call. */
  app.post('/calls/:id/end', async (c) => {
    const callId = c.req.param('id');
    const token = c.req.header('X-Call-Token');
    if (!token) throw badRequest('Missing X-Call-Token header');

    const payload = await verifyCallToken(env.CALL_TOKEN_SECRET, token);
    if (payload.callId !== callId) throw badRequest('Call token does not match this call');

    const state = await loadCallState(env, callId);
    if (!state) throw notFound('Call not found');

    const history = await loadHistory(env, callId);
    const summary = await summarize(provider, history, state.lead.name ?? null);

    const outcome = resolveFinalOutcome(state);
    await endCall(env, { ...state, outcome }, summary);

    return c.json({ ok: true, outcome, summary });
  });

  return app;
}

async function loadHistory(env: Env, callId: string): Promise<TranscriptTurn[]> {
  const { data } = await getServiceClient(env)
    .from('transcript_turns')
    .select('speaker, content, stage')
    .eq('call_id', callId)
    .order('turn_index', { ascending: true })
    .limit(40);

  return (data ?? []).map((row) => ({
    speaker: row.speaker as TranscriptTurn['speaker'],
    content: row.content as string,
    stage: row.stage as TranscriptTurn['stage'],
  }));
}

/**
 * Generates a short call summary for the CRM.
 * Never blocks call completion — a failed summary is not worth losing the call.
 */
async function summarize(
  provider: ReturnType<typeof createLlmProvider>,
  history: TranscriptTurn[],
  name: string | null,
): Promise<string | null> {
  if (history.length === 0) return null;

  const transcript = history
    .map((t) => `${t.speaker === 'agent' ? 'Agent' : 'Prospect'}: ${t.content}`)
    .join('\n')
    .slice(-6000);

  try {
    const stream = await provider.streamText({
      system:
        'Summarize this sales call in 2-3 sentences for a CRM record. State what the prospect ' +
        'said about their home and bill, any objections raised, and the outcome. Plain text, no ' +
        'preamble, no bullet points.',
      messages: [{ role: 'user', content: `Prospect: ${name ?? 'unknown'}\n\n${transcript}` }],
      maxTokens: 200,
      temperature: 0.2,
    });

    let text = '';
    for await (const chunk of stream.chunks) text += chunk;
    return text.trim() || null;
  } catch {
    return null;
  }
}
