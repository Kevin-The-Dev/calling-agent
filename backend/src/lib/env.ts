/**
 * Environment validation.
 *
 * claude.md §11: secrets are never hardcoded and never exposed. This module is
 * the single place env is read — nothing else in the backend touches
 * `process.env` directly, so there is exactly one place to audit.
 *
 * The schema fails fast at boot. A misconfigured deploy should die on startup
 * with a readable message, not halfway through a live call with a prospect on
 * the line.
 */
import { z } from 'zod';

/** Load `.env` for local dev. On Vercel the platform injects env directly. */
function loadDotEnvIfPresent(): void {
  if (process.env['VERCEL'] === '1') return;
  try {
    // Node >=20.12. Absent in older runtimes, hence the guard.
    process.loadEnvFile?.();
  } catch {
    // No .env file — fine when env comes from the shell or CI.
  }
}
loadDotEnvIfPresent();

/** Trims and treats an empty/whitespace-only string as "not set". */
const optionalString = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

const requiredString = (label: string) =>
  z.string({ required_error: `${label} is required` }).trim().min(1, `${label} must not be empty`);

const boolish = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .default(fallback ? 'true' : 'false');

const intFromString = (fallback: number) => z.coerce.number().int().positive().default(fallback);

/** Time window like "09:00-12:00", used for appointment slot generation. */
const timeWindow = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, 'must look like "09:00-12:00"');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: intFromString(8787),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    // ── Supabase ─────────────────────────────────────────────────────────────
    /*
     * `.url()` alone is not enough: Zod accepts any scheme, so a pasted
     * `postgresql://postgres:pw@db.<ref>.supabase.co:5432/postgres` passes it.
     * That is a real mistake that happened during setup, and it is a dangerous
     * one — the connection string embeds the database password. Require an
     * http(s) scheme explicitly. (http is allowed for `supabase start` locally.)
     */
    SUPABASE_URL: requiredString('SUPABASE_URL')
      .url('SUPABASE_URL must be a URL')
      .refine((value) => /^https?:\/\//.test(value), {
        message:
          'SUPABASE_URL must be the API project URL (https://<ref>.supabase.co), not the ' +
          'postgresql:// connection string — that string contains your database password ' +
          'and must never be used here',
      }),
    SUPABASE_ANON_KEY: requiredString('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: requiredString('SUPABASE_SERVICE_ROLE_KEY'),
    /** Empty when the project uses asymmetric JWT signing keys — see .env notes. */
    SUPABASE_JWT_SECRET: optionalString,

    // ── LLM ──────────────────────────────────────────────────────────────────
    LLM_PROVIDER: z.enum(['glm', 'kimi', 'groq', 'gemini']).default('glm'),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.6),
    LLM_MAX_TOKENS: intFromString(300),
    LLM_TIMEOUT_MS: intFromString(15_000),

    GLM_API_KEY: optionalString,
    GLM_BASE_URL: optionalString,
    GLM_API_STYLE: z.enum(['anthropic', 'openai']).default('anthropic'),
    GLM_ANTHROPIC_VERSION: z.string().default('2023-06-01'),
    GLM_MODEL: z.string().default('glm-4.5-flash'),
    GLM_EXTRACTOR_MODEL: z.string().default('glm-4.5-flash'),
    GLM_KEEPALIVE: boolish(true),

    KIMI_API_KEY: optionalString,
    KIMI_BASE_URL: optionalString,
    KIMI_MODEL: optionalString,

    GROQ_API_KEY: optionalString,
    GROQ_BASE_URL: optionalString,
    GROQ_MODEL: optionalString,

    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: optionalString,

    // ── Voice (D8: browser-only for MVP) ─────────────────────────────────────
    STT_PROVIDER: z.enum(['browser', 'deepgram']).default('browser'),
    TTS_PROVIDER: z.enum(['browser', 'elevenlabs']).default('browser'),
    DEEPGRAM_API_KEY: optionalString,
    ELEVENLABS_API_KEY: optionalString,
    ELEVENLABS_VOICE_ID: optionalString,

    // ── App secrets ──────────────────────────────────────────────────────────
    CALL_TOKEN_SECRET: requiredString('CALL_TOKEN_SECRET').min(
      32,
      'CALL_TOKEN_SECRET must be at least 32 chars — generate with: openssl rand -hex 32',
    ),
    CALL_TOKEN_TTL_SECONDS: intFromString(3600),
    ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    // ── Agent identity (fills the [UNKNOWN] placeholders) ────────────────────
    COMPANY_NAME: optionalString,
    AGENT_NAME: optionalString,
    CONSULTANT_NAME: optionalString,
    SERVICE_AREA: optionalString,
    CALLBACK_NUMBER: optionalString,
    DEFAULT_TIMEZONE: z.string().default('America/Los_Angeles'),

    // ── Conversation guardrails ──────────────────────────────────────────────
    MAX_AIR_CYCLES: intFromString(2),
    MAX_LATE_OBJECTIONS: intFromString(4),
    SILENCE_TIMEOUT_MS: intFromString(6000),

    // ── Booking ──────────────────────────────────────────────────────────────
    BOOKING_HORIZON_DAYS: intFromString(14),
    SLOT_MINUTES: intFromString(45),
    MORNING_WINDOW: timeWindow.default('09:00-12:00'),
    AFTERNOON_WINDOW: timeWindow.default('13:00-18:00'),

    // ── Limits ───────────────────────────────────────────────────────────────
    RATE_LIMIT_TURNS_PER_MIN: intFromString(30),
    RATE_LIMIT_CALLS_PER_HOUR: intFromString(5),
    RECORDING_RETENTION_DAYS: intFromString(180),
  })
  /*
   * Only the *selected* provider's credentials are required. This keeps unused
   * provider blocks empty in .env without failing boot, while still refusing to
   * start if the one we actually depend on is missing.
   */
  .superRefine((env, ctx) => {
    const requireFor = (provider: typeof env.LLM_PROVIDER, key: string, value?: string) => {
      if (env.LLM_PROVIDER === provider && !value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when LLM_PROVIDER="${provider}"`,
        });
      }
    };
    requireFor('glm', 'GLM_API_KEY', env.GLM_API_KEY);
    requireFor('glm', 'GLM_BASE_URL', env.GLM_BASE_URL);
    requireFor('kimi', 'KIMI_API_KEY', env.KIMI_API_KEY);
    requireFor('kimi', 'KIMI_BASE_URL', env.KIMI_BASE_URL);
    requireFor('groq', 'GROQ_API_KEY', env.GROQ_API_KEY);
    requireFor('gemini', 'GEMINI_API_KEY', env.GEMINI_API_KEY);

    if (env.STT_PROVIDER === 'deepgram' && !env.DEEPGRAM_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEEPGRAM_API_KEY'],
        message: 'DEEPGRAM_API_KEY is required when STT_PROVIDER="deepgram"',
      });
    }
    if (env.TTS_PROVIDER === 'elevenlabs' && !env.ELEVENLABS_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ELEVENLABS_API_KEY'],
        message: 'ELEVENLABS_API_KEY is required when TTS_PROVIDER="elevenlabs"',
      });
    }

    // A service-role key in the wrong slot would silently grant god-mode to the
    // browser. Cheap to detect, catastrophic to miss.
    if (env.SUPABASE_ANON_KEY === env.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPABASE_ANON_KEY'],
        message: 'SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must not be the same value',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates the environment.
 *
 * Throws with every problem listed at once rather than one at a time, and
 * never echoes a value — only the variable name and what is wrong with it.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        `Check backend/.env against backend/.env.example.`,
    );
  }

  return result.data;
}

let cached: Env | undefined;

/** Validated env, parsed once per process. */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Test-only: forget the cached env so a fresh one is parsed. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * A redacted view of the config, safe to log at boot.
 * Secrets are reported as set/unset — never printed.
 */
export function describeEnv(env: Env): Record<string, string | number | boolean> {
  const mark = (v: string | undefined) => (v ? 'set' : 'unset');
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    llmProvider: env.LLM_PROVIDER,
    llmModel: env.LLM_PROVIDER === 'glm' ? env.GLM_MODEL : (env.KIMI_MODEL ?? 'n/a'),
    sttProvider: env.STT_PROVIDER,
    ttsProvider: env.TTS_PROVIDER,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceKey: mark(env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseJwtSecret: mark(env.SUPABASE_JWT_SECRET),
    llmApiKey: mark(env.LLM_PROVIDER === 'glm' ? env.GLM_API_KEY : env.KIMI_API_KEY),
    companyName: env.COMPANY_NAME ?? '(unset — agent will use fallback)',
    consultantName: env.CONSULTANT_NAME ?? '(unset — agent says "one of our engineers")',
    allowedOrigins: env.ALLOWED_ORIGINS.join(', '),
  };
}
