import Link from 'next/link';
import {
  PhoneOutgoingIcon,
} from '@phosphor-icons/react/dist/ssr';
import { createClient } from '@/lib/supabase/server';
import { WordmarkLink } from '@/components/brand';
import { DashboardNav } from '@/components/dashboard/nav';
import { SignOutButton } from '@/components/dashboard/sign-out';

export const metadata = {
  title: { default: 'Dashboard', template: '%s · Dashboard' },
  robots: { index: false, follow: false },
};

/**
 * Dashboard shell.
 *
 * The login page renders inside this layout too, and it must not show a sidebar
 * to someone who is not signed in — so the chrome is conditional on there
 * actually being a user rather than on the route.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <>{children}</>;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 z-20 flex flex-col gap-5 border-b border-line bg-paper/90 px-5 py-4 backdrop-blur-xl lg:h-screen lg:border-b-0 lg:border-r lg:px-4 lg:py-6">
        {/* Home is the public site, not the dashboard root — "Overview" in the
            nav below already goes there, so pointing the logo at it too would
            waste the one link every visitor knows how to find. */}
        <WordmarkLink />

        <DashboardNav />

        <div className="mt-auto hidden space-y-3 lg:block">
          <Link
            href="/call"
            className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium shadow-sm transition-colors hover:border-line-strong"
          >
            <PhoneOutgoingIcon className="size-3.5" />
            Open call console
          </Link>

          <div className="rounded-lg bg-sunk px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">
              Signed in
            </p>
            <p className="mt-0.5 truncate text-[12.5px] text-ink-2" title={user.email ?? ''}>
              {user.email}
            </p>
          </div>

          <SignOutButton />
        </div>
      </aside>

      <main className="min-w-0 px-5 py-8 sm:px-8 lg:py-10">{children}</main>
    </div>
  );
}
