import Link from 'next/link';
import {
  ArrowLeftIcon,
} from '@phosphor-icons/react/dist/ssr';
import { CallConsole } from '@/components/call-console';
import { WordmarkLink } from '@/components/brand';

export const metadata = {
  title: 'Talk to us',
};

/**
 * The console on its own.
 *
 * Same component as the landing page, with everything else stripped away — this
 * is the URL to embed or hand to someone already willing to talk, where the
 * surrounding explanation would only be one more thing between them and the
 * button.
 */
export default function CallPage() {
  return (
    <div className="relative min-h-screen texture-grain">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute left-1/2 top-[-25%] size-[55rem] -translate-x-1/2 rounded-full opacity-70 animate-drift"
          style={{
            background: 'radial-gradient(circle, var(--color-accent-wash) 0%, transparent 65%)',
          }}
        />
      </div>

      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-5 py-12">
        <header className="flex items-center justify-between">
          <WordmarkLink />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-accent-deep"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back
          </Link>
        </header>

        <div className="animate-rise">
          <CallConsole />
        </div>
      </div>
    </div>
  );
}
