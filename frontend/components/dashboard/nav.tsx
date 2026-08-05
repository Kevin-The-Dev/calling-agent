'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChartBarIcon,
  PhoneCallIcon,
  UsersIcon,
} from '@phosphor-icons/react/dist/ssr';

const LINKS = [
  { href: '/dashboard', label: 'Overview', icon: ChartBarIcon },
  { href: '/dashboard/leads', label: 'Leads', icon: UsersIcon },
  { href: '/dashboard/calls', label: 'Calls', icon: PhoneCallIcon },
];

/**
 * Sidebar navigation.
 *
 * A client component only because the active item depends on the current path.
 * `/dashboard` is matched exactly — with a prefix match it would stay
 * highlighted on every page, which is the same as highlighting nothing.
 */
export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-0.5">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
              active
                ? 'bg-accent-wash text-accent-deep'
                : 'text-ink-2 hover:bg-sunk hover:text-ink'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
