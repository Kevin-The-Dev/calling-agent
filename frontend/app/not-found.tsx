import Link from 'next/link';
import {
  ArrowLeftIcon,
  PhoneCallIcon,
} from '@phosphor-icons/react/dist/ssr';
import { WordmarkLink } from '@/components/brand';

/**
 * 404.
 *
 * A dead end is the one place a visitor definitely needs a route out, so this
 * offers the two that exist rather than apologising. No "Oops".
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col texture-grain">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-5 sm:px-8">
          <WordmarkLink />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-20 sm:px-8">
        <p className="font-mono text-[13px] tracking-[0.14em] text-accent">404</p>
        <h1 className="mt-4 max-w-[16ch] text-balance font-display text-[clamp(2rem,5vw,3.2rem)] font-semibold leading-[1.05] text-ink">
          That page is not here.
        </h1>
        <p className="mt-5 max-w-[52ch] text-[15.5px] leading-relaxed text-ink-2">
          The link may be old, or the address may have a typo in it. Both of the places worth going
          are below.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link
            href="/#console"
            className="press inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-[14.5px] font-semibold text-paper shadow-lift hover:bg-accent-deep"
          >
            <PhoneCallIcon className="size-4" weight="bold" />
            Start a call
          </Link>
          <Link
            href="/"
            className="press inline-flex items-center gap-2 rounded-full border border-line bg-surface px-6 py-3 text-[14.5px] font-medium text-ink-2 hover:border-line-strong hover:text-ink"
          >
            <ArrowLeftIcon className="size-4" weight="bold" />
            Home
          </Link>
        </div>
      </main>
    </div>
  );
}
