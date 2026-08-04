/**
 * Hono application.
 *
 * Kept separate from the server entry point so tests can exercise routes with
 * `app.request()` without opening a socket, and so the Vercel handler and the
 * local Node server share one definition.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { getEnv, type Env } from './lib/env.js';
import { AppError, toAppError } from './lib/errors.js';
import { createLogger } from './lib/logger.js';
import { callRoutes } from './routes/calls.js';
import { healthRoutes } from './routes/health.js';

/**
 * Per-request context values.
 * Declared so `c.set`/`c.get` are typed rather than stringly-keyed.
 */
export interface AppVariables {
  requestId: string;
}

export type AppEnv = { Variables: AppVariables };

export function createApp(env: Env = getEnv()) {
  const app = new Hono<AppEnv>();
  const logger = createLogger(env.LOG_LEVEL, { service: 'backend' });

  app.use('*', secureHeaders());

  // claude.md §11 — an explicit origin allowlist, never a wildcard. The call
  // widget sends a call token, so credentials must be permitted.
  app.use(
    '*',
    cors({
      origin: (origin) => (env.ALLOWED_ORIGINS.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Call-Token'],
      credentials: true,
      maxAge: 86400,
    }),
  );

  // Request logging with a correlation id, so one call's turns can be traced.
  app.use('*', async (c, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);

    await next();

    logger.info('request', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  });

  app.route('/api', healthRoutes(env));
  app.route('/api', callRoutes(env));

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));

  // Single error boundary. Full detail is logged server-side; the client only
  // ever receives the typed, safe shape from AppError.
  app.onError((err, c) => {
    const appError = toAppError(err);

    logger.error('unhandled_error', {
      requestId: c.get('requestId'),
      path: c.req.path,
      code: appError.code,
      message: appError.message,
      detail: appError.detail,
    });

    return c.json(appError.toResponseBody(), appError.status as 400);
  });

  return app;
}

export { AppError };
