/**
 * In-process call context cache.
 *
 * Every turn needs the call state and the recent transcript before the model
 * can be asked for anything. Measured against this Supabase project
 * (ap-northeast-1) that is ~170ms per round trip, and the route originally made
 * three of them in sequence — ~525ms of dead air before the first token was
 * even requested.
 *
 * None of it is actually unknown. The turn engine produces the next state, and
 * the route already knows what both sides said, so the context for turn N+1 can
 * simply be kept. That takes turns 2..n to zero reads.
 *
 * Staleness is bounded by design rather than by hope:
 *
 *   - The cache is per-process. A second instance misses and reads the database,
 *     which is correct, just slower.
 *   - It can only go stale if two instances serve turns for the *same* call.
 *     That case fails loudly instead of silently: `transcript_turns` carries
 *     `unique (call_id, turn_index)`, so a replayed index is rejected by
 *     Postgres rather than quietly corrupting the transcript.
 *
 * Entries are evicted least-recently-used first, and expire well inside the
 * call token's TTL.
 */
import type { CallState, TranscriptTurn } from '../types/domain.js';

export interface CallContext {
  state: CallState;
  history: TranscriptTurn[];
}

interface CacheEntry extends CallContext {
  touchedAt: number;
}

/** Matches the history window the prompt actually uses. */
const HISTORY_LIMIT = 40;
const MAX_ENTRIES = 500;
const TTL_MS = 15 * 60_000;

/** Map preserves insertion order, which is all an LRU needs. */
const entries = new Map<string, CacheEntry>();

export function readCallContext(callId: string): CallContext | null {
  const entry = entries.get(callId);
  if (!entry) return null;

  if (Date.now() - entry.touchedAt > TTL_MS) {
    entries.delete(callId);
    return null;
  }

  // Re-insert so this becomes the most recently used key.
  entries.delete(callId);
  entry.touchedAt = Date.now();
  entries.set(callId, entry);

  return { state: entry.state, history: entry.history };
}

export function writeCallContext(callId: string, context: CallContext): void {
  entries.delete(callId);
  entries.set(callId, {
    state: context.state,
    history: context.history.slice(-HISTORY_LIMIT),
    touchedAt: Date.now(),
  });

  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

/** Called when a call ends — nothing will ask for it again. */
export function dropCallContext(callId: string): void {
  entries.delete(callId);
}

/** Test seam. */
export function clearCallContextCache(): void {
  entries.clear();
}
