import Link from 'next/link';

export const metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-line)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm font-semibold">
            Sales Agent Dashboard
          </Link>
          <nav className="flex gap-4 text-sm text-[var(--color-ink-soft)]">
            <Link href="/dashboard">Leads</Link>
            <Link href="/call">Call widget</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
