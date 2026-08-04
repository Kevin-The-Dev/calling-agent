'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Admin sign-in.
 *
 * Sign-in only — there is deliberately no signup form (claude.md §10, "no
 * public login"). Accounts are created in Supabase and given a `profiles` row;
 * a user in `auth.users` without one can authenticate but still reads nothing.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      // Deliberately generic: distinguishing "no such user" from "wrong
      // password" tells an attacker which addresses are valid admins.
      setError('Those credentials were not accepted.');
      setBusy(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-5 rounded-xl border border-[var(--color-line)] p-8"
      >
        <div>
          <h1 className="text-lg font-semibold">Admin sign in</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Authorized staff only.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--color-bad)]">
            {error}
          </p>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-[var(--color-line)] bg-transparent px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-[var(--color-line)] bg-transparent px-3 py-2"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
