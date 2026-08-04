'use client';

/**
 * Browser Supabase client.
 *
 * Uses the anon key only. Every table is default-deny under the RLS policies
 * in database.md §5, so this key grants nothing on its own — it becomes useful
 * only after an admin signs in and their JWT carries a `profiles` row.
 *
 * Used for dashboard auth and Realtime (live calls). All lead and call *writes*
 * go through the backend service-role client, never from here.
 */
import { createBrowserClient } from '@supabase/ssr';
import { getPublicEnv } from '../env';

export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
