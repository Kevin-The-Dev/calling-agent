'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { WordmarkLink } from '@/components/brand';

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
    <div className="relative grid min-h-screen place-items-center px-5 py-12 texture-grain">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute left-1/2 top-[-20%] size-[50rem] -translate-x-1/2 rounded-full opacity-60 animate-drift"
          style={{
            background: 'radial-gradient(circle, var(--color-solar-wash) 0%, transparent 65%)',
          }}
        />
      </div>

      <div className="w-full max-w-sm animate-rise">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <WordmarkLink />
          <p className="text-[13px] text-ink-3">Authorized staff only.</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card"
        >
          <div className="flex items-center gap-2.5 border-b border-line pb-4">
            <span className="grid size-9 place-items-center rounded-lg border border-solar-line bg-solar-wash">
              <KeyRound className="size-4 text-solar-deep" />
            </span>
            <div>
              <h1 className="text-[14.5px] font-semibold">Sign in</h1>
              <p className="text-[12.5px] text-ink-3">Access the lead pipeline</p>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-alert/25 bg-alert-wash px-3 py-2.5 text-[13px] text-alert"
            >
              {error}
            </p>
          )}

          <Field
            label="Email"
            icon={<Mail className="size-3.5" />}
            type="email"
            autoComplete="username"
            value={email}
            onChange={setEmail}
          />

          <Field
            label="Password"
            icon={<Lock className="size-3.5" />}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-3 text-[14px] font-semibold text-paper transition-colors hover:bg-solar-deep disabled:cursor-not-allowed disabled:bg-ink-4"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="flex items-center justify-center gap-1.5 pt-1 text-[12px] text-ink-3">
            <ShieldCheck className="size-3.5" />
            Protected by row-level security
          </p>
        </form>

        <Link
          href="/"
          className="mt-6 flex items-center justify-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-solar-deep"
        >
          <ArrowLeft className="size-3.5" />
          Back to the call console
        </Link>
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  type,
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  type: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
        <span className="text-ink-3">{icon}</span>
        {label}
      </span>
      <input
        type={type}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-sunk/50 px-3 py-2.5 text-[14px] text-ink transition-colors placeholder:text-ink-4 focus:border-solar focus:bg-surface focus:outline-none"
      />
    </label>
  );
}
