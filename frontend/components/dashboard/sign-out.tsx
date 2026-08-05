'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

/**
 * Sign out.
 *
 * `router.refresh()` after signing out matters: every dashboard page is a
 * server component rendered with the session cookie, so without it the user
 * would keep looking at fully-rendered data they no longer have access to
 * until something else triggered a re-render.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void createClient()
          .auth.signOut()
          .then(() => {
            router.push('/dashboard/login');
            router.refresh();
          });
      }}
      className="inline-flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-sunk hover:text-ink disabled:opacity-50"
    >
      <LogOut className="size-4" />
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
