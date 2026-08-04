import { describe, expect, it } from 'vitest';
import { describeEnv, parseEnv } from '../src/lib/env.js';

/**
 * A minimally valid environment. Individual tests mutate a copy to prove that
 * each guard actually fires — env validation is the boot gate, so a rule that
 * silently doesn't apply is worse than no rule.
 */
const valid = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-value',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value',
  LLM_PROVIDER: 'glm',
  GLM_API_KEY: 'glm-key',
  GLM_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
  CALL_TOKEN_SECRET: 'a'.repeat(64),
} satisfies NodeJS.ProcessEnv;

describe('parseEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = parseEnv({ ...valid });

    expect(env.LLM_PROVIDER).toBe('glm');
    expect(env.GLM_MODEL).toBe('glm-4.5-flash');
    expect(env.STT_PROVIDER).toBe('browser');
    expect(env.TTS_PROVIDER).toBe('browser');
    expect(env.PORT).toBe(8787);
    expect(env.ALLOWED_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('rejects a postgres connection string in SUPABASE_URL', () => {
    // The exact mistake made during setup: the database connection string was
    // pasted where the API project URL belongs.
    expect(() =>
      parseEnv({
        ...valid,
        SUPABASE_URL: 'postgresql://postgres:pw@db.example.supabase.co:5432/postgres',
      }),
    ).toThrow(/SUPABASE_URL/);
  });

  it('rejects a CALL_TOKEN_SECRET that is too short to be safe', () => {
    expect(() => parseEnv({ ...valid, CALL_TOKEN_SECRET: 'short' })).toThrow(
      /at least 32 chars/,
    );
  });

  it('rejects the service-role key being reused as the anon key', () => {
    expect(() =>
      parseEnv({ ...valid, SUPABASE_ANON_KEY: valid.SUPABASE_SERVICE_ROLE_KEY }),
    ).toThrow(/must not be the same value/);
  });

  it('requires credentials only for the selected LLM provider', () => {
    // Selecting kimi without a kimi key must fail...
    expect(() => parseEnv({ ...valid, LLM_PROVIDER: 'kimi' })).toThrow(/KIMI_API_KEY/);

    // ...but leaving the unused kimi block empty while on glm is fine.
    expect(() => parseEnv({ ...valid, KIMI_API_KEY: '', KIMI_BASE_URL: '' })).not.toThrow();
  });

  it('requires a Deepgram key only when Deepgram is selected', () => {
    expect(() => parseEnv({ ...valid, STT_PROVIDER: 'deepgram' })).toThrow(/DEEPGRAM_API_KEY/);
    expect(() =>
      parseEnv({ ...valid, STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'dg-key' }),
    ).not.toThrow();
  });

  it('reports every problem at once rather than one per run', () => {
    let message = '';
    try {
      parseEnv({ CALL_TOKEN_SECRET: 'short' });
    } catch (err) {
      message = err instanceof Error ? err.message : '';
    }

    expect(message).toContain('SUPABASE_URL');
    expect(message).toContain('SUPABASE_ANON_KEY');
    expect(message).toContain('CALL_TOKEN_SECRET');
  });

  it('parses a comma-separated origin allowlist', () => {
    const env = parseEnv({
      ...valid,
      ALLOWED_ORIGINS: 'http://localhost:3000, https://app.example.com',
    });
    expect(env.ALLOWED_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('rejects a malformed booking window', () => {
    expect(() => parseEnv({ ...valid, MORNING_WINDOW: 'morning' })).toThrow(/09:00-12:00/);
  });
});

describe('describeEnv', () => {
  it('never echoes a secret value', () => {
    const described = describeEnv(parseEnv({ ...valid }));
    const serialized = JSON.stringify(described);

    expect(serialized).not.toContain(valid.GLM_API_KEY);
    expect(serialized).not.toContain(valid.SUPABASE_SERVICE_ROLE_KEY);
    expect(serialized).not.toContain(valid.CALL_TOKEN_SECRET);
    expect(described['llmApiKey']).toBe('set');
    expect(described['supabaseServiceKey']).toBe('set');
  });

  it('flags unset identity values rather than inventing them', () => {
    const described = describeEnv(parseEnv({ ...valid }));
    expect(String(described['consultantName'])).toContain('one of our engineers');
  });
});
