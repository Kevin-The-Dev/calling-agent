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
import type { LlmProvider } from '../services/llm/index.js';
import {
  endCall,
  initialCallState,
  loadCallContext,
  loadHistory,
  persistTurn,
  recordEvent,
  startCall,
} from '../services/calls.js';
import {
  dropCallContext,
  readCallContext,
  writeCallContext,
} from '../services/call-cache.js';
import { normalizeMimeType, storeRecording } from '../services/recordings.js';
import type { TranscriptTurn } from '../types/domain.js';

const startSchema = z.object({
  consent: z.boolean(),
});

const turnSchema = z.object({
  utterance: z.string().trim().min(1, 'utterance must not be empty').max(2000),
  /**
   * Where this utterance sits in the recording, in milliseconds from the moment
   * capture began. The agent speaks through browser synthesis and is therefore
   * absent from the audio file (implementation.md R13), so the prospect's own
   * windows are the only fixed points the dashboard can sync a transcript to.
   * Optional: a client that does not send them still records a valid turn.
   */
  audioStartMs: z.number().int().min(0).optional(),
  audioEndMs: z.number().int().min(0).optional(),
});

/**
 * Sent by the client for the very first turn. The agent speaks first — a real
 * setter opens the call — so there is no prospect utterance to transcribe yet.
 */
const CALL_START_SENTINEL = '__call_started__';
const CALL_START_CUE = '(The call has just connected. Open the conversation.)';

/**
 * Upload ceiling for a recording.
 *
 * Opus at browser defaults runs ~0.5MB/minute, so 25MB covers a conversation
 * far longer than any real appointment-setting call while keeping a malformed
 * or hostile upload from being buffered into memory.
 */
const MAX_RECORDING_BYTES = 25 * 1_000_000;

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

export function callRoutes(env: Env, provider: LlmProvider) {
  const app = new Hono();
  const logger = createLogger(env.LOG_LEVEL, { component: 'calls' });
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

    // Seed the cache with the state we just created. The opening turn follows
    // within milliseconds and is the one turn with nothing to mask its latency,
    // so it should not pay for reading back a row we wrote ourselves.
    writeCallContext(callId, {
      state: initialCallState(callId, leadId, env.DEFAULT_TIMEZONE),
      history: [],
    });

    // Analytics, not a precondition for talking. Awaiting it would put a write
    // round trip between "Start call" and the agent's first word.
    void recordEvent(env, callId, 'consent', { given: true }).catch((err: unknown) => {
      logger.warn('consent_event_failed', {
        callId,
        message: err instanceof Error ? err.message : String(err),
      });
    });

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

    // Cache hit on every turn after the first, on the instance that served the
    // previous one. A miss costs one round trip, not three.
    const context = readCallContext(callId) ?? (await loadCallContext(env, callId));
    if (!context) throw notFound('Call not found');

    const { state, history } = context;
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

        // The opening turn has no prospect speech — record it as a system
        // marker so turn indices stay contiguous and the transcript reads
        // correctly in the dashboard.
        const prospectUtterance = isCallStart ? '[call connected]' : utterance;

        // Carry the conversation forward in memory so the next turn needs no
        // reads. Written before persistence because it does not depend on it.
        writeCallContext(callId, {
          state: turn.state,
          history: [
            ...history,
            { speaker: 'prospect', content: prospectUtterance, stage: previousStage },
            { speaker: 'agent', content: turn.reply, stage: turn.state.stage },
          ],
        });

        // `done` goes out before the writes. The client uses it to hand the
        // microphone back, and three sequential inserts (~500ms) between the
        // agent's last word and the prospect being able to answer is exactly
        // the pause that makes a call feel like software.
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            stage: turn.state.stage,
            finished: turn.state.stage === 'ended' || turn.state.stage === 'disqualified',
            outcome: turn.state.outcome,
            latencyMs: turn.latencyToFirstTokenMs,
          }),
        });

        // Still awaited inside the stream callback: on a serverless runtime the
        // function may be frozen the moment the handler returns, and a dropped
        // transcript is not an acceptable trade for latency already banked.
        try {
          await persistTurn(env, {
            state: turn.state,
            prospectUtterance,
            agentReply: turn.reply,
            previousStage,
            latencyMs: turn.latencyToFirstTokenMs,
            tokensIn: turn.tokensIn,
            tokensOut: turn.tokensOut,
            objectionId: turn.objectionId,
            objectionQuote: turn.objectionId ? utterance : null,
            audioStartMs: parsed.data.audioStartMs ?? null,
            audioEndMs: parsed.data.audioEndMs ?? null,
          });
        } catch (err) {
          // The cached state claims a turn that was never written. Drop it so
          // the next turn rebuilds from what the database actually holds.
          dropCallContext(callId);
          throw err;
        }

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

  /**
   * Upload the call recording.
   *
   * Sent after `/end`, as raw audio bytes rather than multipart — there is
   * exactly one file and no fields, so a form envelope would only add parsing.
   * The call token is the authorization: it is scoped to this one call and
   * expires, so a leaked token cannot be used to write audio to another.
   */
  app.post('/calls/:id/recording', async (c) => {
    const callId = c.req.param('id');
    const token = c.req.header('X-Call-Token');
    if (!token) throw badRequest('Missing X-Call-Token header');

    const payload = await verifyCallToken(env.CALL_TOKEN_SECRET, token);
    if (payload.callId !== callId) throw badRequest('Call token does not match this call');

    const mimeType = normalizeMimeType(c.req.header('Content-Type'));
    if (!mimeType) {
      throw badRequest('Content-Type must be a supported audio type (webm, ogg, mp4, mpeg, wav)');
    }

    const audio = await c.req.arrayBuffer();
    if (audio.byteLength === 0) throw badRequest('The recording is empty');
    if (audio.byteLength > MAX_RECORDING_BYTES) {
      throw badRequest(
        `The recording exceeds the ${Math.round(MAX_RECORDING_BYTES / 1_000_000)}MB limit`,
      );
    }

    const durationHeader = Number(c.req.header('X-Recording-Duration') ?? '');
    const durationSeconds =
      Number.isFinite(durationHeader) && durationHeader > 0 ? Math.round(durationHeader) : null;

    const stored = await storeRecording(env, {
      callId,
      audio,
      mimeType,
      durationSeconds,
    });

    logger.info('recording_stored', {
      callId,
      sizeBytes: stored.sizeBytes,
      durationSeconds,
    });

    return c.json({ ok: true, recordingId: stored.id, sizeBytes: stored.sizeBytes });
  });

  /** Finalize the call. */
  app.post('/calls/:id/end', async (c) => {
    const callId = c.req.param('id');
    const token = c.req.header('X-Call-Token');
    if (!token) throw badRequest('Missing X-Call-Token header');

    const payload = await verifyCallToken(env.CALL_TOKEN_SECRET, token);
    if (payload.callId !== callId) throw badRequest('Call token does not match this call');

    const context = readCallContext(callId) ?? (await loadCallContext(env, callId));
    if (!context) throw notFound('Call not found');

    const { state } = context;
    // Read through rather than trusting the cache: the summary is the CRM's
    // record of the call, so it is worth one round trip to summarize what was
    // actually written rather than what this instance believes it wrote.
    const history = await loadHistory(env, callId);
    const summary = await summarize(provider, history, state.lead.name ?? null);

    const outcome = resolveFinalOutcome(state);
    await endCall(env, { ...state, outcome }, summary);

    dropCallContext(callId);

    return c.json({ ok: true, outcome, summary });
  });

  return app;
}

/**
 * Generates a short call summary for the CRM.
 * Never blocks call completion — a failed summary is not worth losing the call.
 */
async function summarize(
  provider: LlmProvider,
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
