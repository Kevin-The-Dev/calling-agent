import Link from 'next/link';
import {
  ArrowLeftIcon,
} from '@phosphor-icons/react/dist/ssr';
import { WordmarkLink } from '@/components/brand';

/**
 * The shell for the two short text pages.
 *
 * Both are short enough that a layout file would be more machinery than page,
 * and both need the same thing: the wordmark, a way back, and one measured
 * column of type. The 65ch measure is the point of the whole component.
 */
export function ProsePage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen texture-grain">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5 sm:px-8">
          <WordmarkLink />
          <Link
            href="/"
            className="press inline-flex items-center gap-1.5 text-[13.5px] text-ink-2 hover:text-accent"
          >
            <ArrowLeftIcon className="size-3.5" weight="bold" />
            Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <h1 className="text-balance font-display text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1.06] text-ink">
          {title}
        </h1>
        <p className="mt-3 font-mono text-[12.5px] text-ink-3">Last updated {updated}</p>

        <div className="mt-10 max-w-[65ch] space-y-8 text-[15px] leading-relaxed text-ink-2 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:text-ink [&_li]:mt-2 [&_p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-8 text-[13px] sm:px-8">
          <Link href="/privacy" className="text-ink-3 transition-colors hover:text-accent">
            Privacy
          </Link>
          <Link href="/terms" className="text-ink-3 transition-colors hover:text-accent">
            Terms
          </Link>
        </div>
      </footer>
    </div>
  );
}
