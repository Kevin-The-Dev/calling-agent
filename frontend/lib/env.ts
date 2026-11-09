/**
 * Public client configuration.
 *
 * Everything here is inlined into the browser bundle, so it must contain
 * nothing secret. Next.js requires literal `process.env.NEXT_PUBLIC_*` access
 * for that inlining to happen — hence no dynamic lookups below.
 *
 * The server-side secrets (service-role key, LLM keys) live only in
 * backend/.env and are never imported from here.
 */
import { z } from 'zod';

const publicEnvSchema = z.object({
  supabaseUrl: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be the API project URL (https://<ref>.supabase.co)'),
  supabaseAnonKey: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  /**
   * The backend's ORIGIN — scheme and host only, no path.
   *
   * Every path this client requests already begins with `/api`, so a base URL
   * carrying a path produces a doubled one. Pasting the URL that was just
   * curl'd to check the backend was alive gave
   * `…vercel.app/api/health` + `/api/health` = `/api/health/api/health`,
   * which 404s while looking, at a glance, like the right host.
   *
   * A trailing slash is harmless and common, so it is trimmed rather than
   * rejected. A path is not trimmed: silently discarding part of a configured
   * URL would be its own confusing failure. It is reported instead.
   */
  apiBaseUrl: z
    .string()
    .url('NEXT_PUBLIC_API_BASE_URL must be a valid URL')
    .transform((v) => v.replace(/\/+$/, '')),
  /** This bundle's own version, injected from package.json by next.config.ts. */
  appVersion: z.string().default('dev'),
  siteUrl: z.string().url(),
  voiceMode: z.enum(['browser', 'provider']).default('browser'),
  sttLanguage: z.string().default('en-US'),
  showTranscript: z.boolean().default(true),
  requireConsent: z.boolean().default(true),
  /**
   * Silence, in milliseconds, before an utterance is treated as finished.
   * Lower feels faster but clips people who pause mid-sentence; see
   * voice/speech.ts for what this actually controls.
   */
  endpointMs: z.number().int().min(200).max(3000).default(1200),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

const asBool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value === 'true' || value === '1';

const asInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

let cached: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  if (cached) return cached;

  const result = publicEnvSchema.safeParse({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    voiceMode: process.env.NEXT_PUBLIC_VOICE_MODE,
    sttLanguage: process.env.NEXT_PUBLIC_STT_LANGUAGE,
    showTranscript: asBool(process.env.NEXT_PUBLIC_SHOW_TRANSCRIPT, true),
    requireConsent: asBool(process.env.NEXT_PUBLIC_REQUIRE_CONSENT, true),
    endpointMs: asInt(process.env.NEXT_PUBLIC_ENDPOINT_MS, 1200),
  });

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid frontend environment:\n${problems}\n\nCheck frontend/.env.local against frontend/.env.example.`,
    );
  }

  cached = result.data;
  return cached;
}

/**
 * A misconfigured `NEXT_PUBLIC_API_BASE_URL`, described — or null if it is fine.
 *
 * Deliberately not a schema `refine`. Every caller of `getPublicEnv` is a
 * component, so throwing here replaces the page with Next's generic client-side
 * exception screen, which says nothing about the actual problem. Reporting it as
 * a value lets the UI show the explanation in place of the status it would
 * otherwise have fetched.
 *
 * The case this exists for: the value must be the backend ORIGIN, because every
 * request already appends its own `/api/...`. Pasting the URL you just curl'd to
 * check the backend was alive gives `…vercel.app/api/health` as the base, and
 * then `/api/health/api/health` as the request — which 404s while looking, at a
 * glance, like the correct host. The 404 arrives as a perfectly ordinary
 * "Not found" from the backend, so nothing about it points at the base URL.
 */
export function describeApiBaseUrlProblem(): string | null {
  const { apiBaseUrl } = getPublicEnv();
  const { pathname } = new URL(apiBaseUrl);

  if (pathname !== '/') {
    return (
      `NEXT_PUBLIC_API_BASE_URL is set to ${apiBaseUrl}, which includes the path "${pathname}". ` +
      'It must be the backend origin only — every request adds its own /api/... path, so this ' +
      'produces a doubled URL. Remove the path and redeploy.'
    );
  }

  return null;
}
