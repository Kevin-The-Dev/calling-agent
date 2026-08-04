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
  apiBaseUrl: z.string().url('NEXT_PUBLIC_API_BASE_URL must be a valid URL'),
  siteUrl: z.string().url(),
  voiceMode: z.enum(['browser', 'provider']).default('browser'),
  sttLanguage: z.string().default('en-US'),
  showTranscript: z.boolean().default(true),
  requireConsent: z.boolean().default(true),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

const asBool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value === 'true' || value === '1';

let cached: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  if (cached) return cached;

  const result = publicEnvSchema.safeParse({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    voiceMode: process.env.NEXT_PUBLIC_VOICE_MODE,
    sttLanguage: process.env.NEXT_PUBLIC_STT_LANGUAGE,
    showTranscript: asBool(process.env.NEXT_PUBLIC_SHOW_TRANSCRIPT, true),
    requireConsent: asBool(process.env.NEXT_PUBLIC_REQUIRE_CONSENT, true),
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
