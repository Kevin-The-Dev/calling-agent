import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/lib/env.js';

const env = parseEnv({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-value',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value',
  LLM_PROVIDER: 'glm',
  GLM_API_KEY: 'glm-key',
  GLM_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
  CALL_TOKEN_SECRET: 'a'.repeat(64),
  ALLOWED_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const app = createApp(env);

describe('GET /api/health', () => {
  it('reports liveness without touching any downstream service', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('ok');
    expect(body['service']).toBe('calling-agent-backend');
  });

  it('attaches a correlation id to every response', async () => {
    const res = await app.request('/api/health');
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets security headers', async () => {
    const res = await app.request('/api/health');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('CORS', () => {
  it('reflects an allowed origin', async () => {
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  });

  it('refuses an origin that is not on the allowlist', async () => {
    const res = await app.request('/api/health', {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example.com');
  });
});

describe('error handling', () => {
  it('returns the typed envelope for an unknown route', async () => {
    const res = await app.request('/api/does-not-exist');
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    // The envelope must carry a code and a message and nothing else — no stack,
    // no internal detail.
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
  });
});
