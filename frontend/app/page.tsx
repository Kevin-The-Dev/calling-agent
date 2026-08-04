import { SystemStatus } from '@/components/system-status';

/**
 * M1 foundation page.
 *
 * Deliberately minimal: its only job is to prove the frontend, the backend, and
 * the environment wiring are all real. The call widget replaces it in M4 and the
 * dashboard lands in M6.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-ink-soft)]">
          Milestone 1 · Foundation
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">AI Voice Sales Agent</h1>
        <p className="text-[var(--color-ink-soft)]">
          Workspace, backend, and database wiring. The call widget arrives in M4.
        </p>
      </header>

      <SystemStatus />

      <footer className="text-sm text-[var(--color-ink-soft)]">
        <p>
          Next up: knowledge loader and prompt assembly (M2), then the conversation engine (M3).
        </p>
      </footer>
    </main>
  );
}
