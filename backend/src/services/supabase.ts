/**
 * Supabase client.
 *
 * database.md §5: the browser never writes to Postgres. Every write goes
 * through this service-role client, which bypasses RLS — so it must never be
 * constructed anywhere that could run client-side.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../lib/env.js';
import type { Database } from '../types/database.js';

/** Typed against the real schema — regenerate with `pnpm db:types` after a migration. */
export type Db = SupabaseClient<Database>;

let cached: Db | undefined;

/**
 * Service-role client. Full database access, RLS bypassed.
 * Server-only. Never expose this or its key to a browser.
 */
export function getServiceClient(env: Env): Db {
  cached ??= createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // No user session on the server: nothing to persist or refresh.
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: { 'x-application-name': 'calling-agent-backend' },
    },
  });
  return cached;
}

/** Test-only: drop the memoized client. */
export function resetSupabaseCache(): void {
  cached = undefined;
}

export interface SupabaseHealth {
  ok: boolean;
  latencyMs: number;
  /** True once migrations have been applied. */
  migrationsApplied: boolean;
  error?: string;
}

/**
 * Liveness probe.
 *
 * Distinguishes "cannot reach Supabase" from "reachable but not migrated yet",
 * because during M1 the second is expected and must not read as a failure.
 * PGRST205 is PostgREST's "table not in schema cache".
 */
export async function checkSupabaseHealth(env: Env): Promise<SupabaseHealth> {
  const startedAt = Date.now();
  const client = getServiceClient(env);

  try {
    const { error } = await client.from('leads').select('id').limit(1);
    const latencyMs = Date.now() - startedAt;

    if (!error) return { ok: true, latencyMs, migrationsApplied: true };

    if (error.code === 'PGRST205' || error.message.includes('schema cache')) {
      return { ok: true, latencyMs, migrationsApplied: false };
    }

    return { ok: false, latencyMs, migrationsApplied: false, error: error.message };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      migrationsApplied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
