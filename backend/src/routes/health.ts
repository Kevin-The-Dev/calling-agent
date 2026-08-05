/**
 * Health and readiness endpoints.
 *
 * GET /api/health  — liveness. Cheap, no downstream calls. For uptime checks.
 * GET /api/ready   — readiness. Actually calls Supabase and the LLM.
 *
 * Neither ever returns a secret; `describeEnv` reports credentials as
 * set/unset only (claude.md §11).
 */
import { Hono } from 'hono';
import { describeEnv, type Env } from '../lib/env.js';
import { createLlmProvider } from '../services/llm/index.js';
import { checkSupabaseHealth } from '../services/supabase.js';

/** The deployed service version, reported by `GET /api/health`. */
export const SERVICE_VERSION = '0.2.1';

export function healthRoutes(env: Env) {
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'calling-agent-backend',
      // Kept in step with backend/package.json by hand — it is what the landing
      // page's status pill reads back, so a stale value here reads as a stale
      // deploy.
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
    }),
  );

  app.get('/ready', async (c) => {
    const [supabase, llm] = await Promise.all([
      checkSupabaseHealth(env),
      createLlmProvider(env)
        .ping()
        .then((r) => ({ ok: true as const, latencyMs: r.latencyMs }))
        .catch((err: unknown) => ({
          ok: false as const,
          latencyMs: -1,
          error: err instanceof Error ? err.message : String(err),
        })),
    ]);

    // Missing migrations are expected until M1's migration step has run, so
    // they are reported but do not fail readiness.
    const ready = supabase.ok && llm.ok;

    return c.json(
      {
        status: ready ? 'ready' : 'degraded',
        checks: {
          supabase: {
            ok: supabase.ok,
            latencyMs: supabase.latencyMs,
            migrationsApplied: supabase.migrationsApplied,
            ...(supabase.error ? { error: supabase.error } : {}),
          },
          llm: {
            ok: llm.ok,
            provider: env.LLM_PROVIDER,
            model: env.LLM_PROVIDER === 'glm' ? env.GLM_MODEL : (env.KIMI_MODEL ?? 'unknown'),
            latencyMs: llm.latencyMs,
            ...('error' in llm ? { error: llm.error } : {}),
          },
        },
        config: describeEnv(env),
        timestamp: new Date().toISOString(),
      },
      ready ? 200 : 503,
    );
  });

  return app;
}
