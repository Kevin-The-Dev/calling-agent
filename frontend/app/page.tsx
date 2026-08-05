import Link from 'next/link';
import {
  ArrowUpRightIcon,
  CalendarCheckIcon,
  CurrencyCircleDollarIcon,
  GaugeIcon,
  HouseIcon,
  ShieldWarningIcon,
  UsersIcon,
} from '@phosphor-icons/react/dist/ssr';
import { CallConsole } from '@/components/call-console';
import { SystemStatus } from '@/components/system-status';
import { LogoMark, WordmarkLink } from '@/components/brand';

/**
 * The main page.
 *
 * The console is the product, so it is placed where the eye lands first and
 * everything else explains what just happened. The supporting sections are
 * drawn from what the agent genuinely does: the eight stages below are the
 * server's state machine, and the captured fields are the real lead object,
 * because a page that describes a different product than the one running on it
 * is worse than no page.
 *
 * Every section uses a different layout family on purpose. The stages are a
 * split reading list, the record is an uneven tile grid, the limits are a
 * hanging-icon list. Four sections that all resolve to a row of equal cards is
 * the shape every generated page has, and it reads as one.
 */

const STAGES = [
  { label: 'Opening', copy: 'Confirms it is the homeowner, by name.' },
  { label: 'Reason', copy: 'The neighbourhood rate complaint, then SGIP.' },
  { label: 'Qualifying', copy: 'Bill, roof, ownership, credit band. One at a time.' },
  { label: 'Discovery', copy: 'Makes the bill feel real before any pitch.' },
  { label: 'Value', copy: 'The bill swap, in their own numbers.' },
  { label: 'Booking', copy: 'Narrows the window, then offers one time.' },
  { label: 'Confirm', copy: 'Conflicts, decision makers, best number.' },
  { label: 'Recap', copy: 'Five points, then a warm sign-off.' },
];

const CAPTURED = [
  {
    icon: HouseIcon,
    label: 'The property',
    fields: 'Address, home type, roof ownership, shading',
    lead: true,
  },
  { icon: CurrencyCircleDollarIcon, label: 'The bill', fields: 'Monthly spend and utility provider' },
  { icon: UsersIcon, label: 'The people', fields: 'Name, contact, who else has to be there' },
  { icon: GaugeIcon, label: 'The read', fields: 'Qualification band, buying intent, objections' },
];

const LIMITS = [
  {
    title: 'It promises nothing',
    copy: 'No approval, no dollar figure, no free roof. Savings are only ever described as 20 to 50% cheaper.',
  },
  {
    title: 'It says what it is',
    copy: 'Ask whether you are talking to an AI and it tells you plainly, then carries on with the call.',
  },
  {
    title: 'It takes no for an answer',
    copy: 'Ask to be taken off the list and the call stops there. No rebuttal, no second attempt.',
  },
  {
    title: 'It admits what it does not know',
    copy: 'Where the answer is not something it can stand behind, it says so and notes it for the engineer.',
  },
];

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden texture-grain">
      {/* One quiet light source behind the console, fixed so scrolling moves
          content through it. No drifting mesh: the page has a live audio
          element in it, and a second thing moving competes with it. */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -right-[10%] -top-[25%] size-[60rem] rounded-full opacity-60"
          style={{
            background: 'radial-gradient(circle, var(--color-accent-wash) 0%, transparent 65%)',
          }}
        />
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
          <WordmarkLink />

          <div className="hidden items-center gap-7 text-[13.5px] text-ink-2 md:flex">
            <a href="#how" className="transition-colors hover:text-accent">
              How it runs
            </a>
            <a href="#record" className="transition-colors hover:text-accent">
              What it records
            </a>
            <a href="#limits" className="transition-colors hover:text-accent">
              Limits
            </a>
          </div>

          <Link
            href="/dashboard"
            className="press group inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-[13.5px] font-medium shadow-sm hover:border-line-strong hover:shadow-card"
          >
            Dashboard
            <ArrowUpRightIcon
              className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              weight="bold"
            />
          </Link>
        </nav>
      </header>

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────────
            Asymmetric split. The console sits in the right column and is the
            call to action, so there is no button in the copy competing with
            it. Three text elements, and the console is not one of them. */}
        <section className="mx-auto max-w-6xl px-5 pb-20 pt-12 sm:px-8 lg:pb-28 lg:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_minmax(0,27rem)] lg:gap-16">
            <div className="stagger">
              <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-accent">
                SGIP savings consultation
              </p>

              <h1 className="mt-5 text-balance font-display text-[clamp(2.4rem,5.6vw,3.9rem)] font-semibold leading-[1.03] text-ink">
                Find out if your roof pays for itself.
              </h1>

              <p className="mt-6 max-w-[46ch] text-[16.5px] leading-relaxed text-ink-2">
                Two minutes on the phone with our assistant. If your home qualifies, it books an
                engineer to come out and go through the numbers.
              </p>

              {/* Sits in the copy column rather than under the console: it is a
                  status line, and hanging it off the bottom of the card read as
                  part of the control it is not part of. */}
              <div className="mt-8">
                <SystemStatus />
              </div>
            </div>

            <div className="animate-rise lg:-mt-6">
              <CallConsole />
            </div>
          </div>
        </section>

        {/* ── How it runs ──────────────────────────────────────────────────
            A split reading list, not a card row. Two columns of four, so the
            eye reads down a short list twice rather than across eight tiles. */}
        <section id="how" className="border-y border-line bg-surface/70">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-16">
              <div>
                <h2 className="text-balance font-display text-[clamp(1.8rem,3.2vw,2.5rem)] font-semibold leading-[1.08] text-ink">
                  Eight stages, never out of order
                </h2>
                <p className="mt-5 max-w-[42ch] text-[15px] leading-relaxed text-ink-2">
                  The assistant holds its place in a real sales process. It cannot skip to booking
                  because someone sounded keen, and an objection is a detour it comes back from.
                </p>
              </div>

              <ol className="grid gap-x-12 sm:grid-cols-2">
                {STAGES.map(({ label, copy }, i) => (
                  <li
                    key={label}
                    className="group flex gap-4 border-b border-line py-4 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0"
                  >
                    <span className="tnum mt-0.5 font-mono text-[12px] text-ink-4 transition-colors group-hover:text-accent">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className="text-[14.5px] font-semibold text-ink">{label}</h3>
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{copy}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ── What it records ──────────────────────────────────────────────
            Four items, four cells, uneven. The first is tinted and spans the
            column because the property is what the whole qualification turns
            on, and a grid of four identical tiles says nothing about that. */}
        <section id="record" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <h2 className="max-w-[18ch] text-balance font-display text-[clamp(1.8rem,3.2vw,2.5rem)] font-semibold leading-[1.08] text-ink">
            Everything said, written down
          </h2>
          <p className="mt-5 max-w-[58ch] text-[15px] leading-relaxed text-ink-2">
            The assistant updates a live record after every answer, so nothing depends on anyone
            remembering. Transcripts and recordings land in the dashboard as the call ends.
          </p>

          {/* Two blocks, four items, no empty cell. The property is the thing
              the whole qualification turns on, so it gets its own panel; the
              other three read as a list beside it rather than as three more
              tiles of the same weight. */}
          <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
            <article className="press flex flex-col justify-between gap-10 rounded-2xl border border-accent-line bg-accent-wash p-6 hover:-translate-y-0.5 hover:shadow-card">
              <HouseIcon className="size-7 text-accent-deep" weight="duotone" />
              <div>
                <h3 className="text-[19px] font-semibold text-accent-deep">{CAPTURED[0]!.label}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-accent-deep">
                  {CAPTURED[0]!.fields}
                </p>
              </div>
            </article>

            <div className="grid rounded-2xl border border-line bg-surface px-6 shadow-sm">
              {CAPTURED.slice(1).map(({ icon: Icon, label, fields }) => (
                <div
                  key={label}
                  className="flex items-start gap-4 border-b border-line py-5 last:border-b-0"
                >
                  <Icon className="mt-0.5 size-5 shrink-0 text-ink-3" weight="duotone" />
                  <div>
                    <h3 className="text-[14.5px] font-semibold text-ink">{label}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{fields}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Limits ───────────────────────────────────────────────────────
            A hanging-icon list on a recessed ground. Recessed rather than
            inverted: one black slab dropped into a light page reads as a
            paste, not as emphasis. */}
        <section id="limits" className="border-y border-line bg-paper-deep">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16">
            <div>
              <h2 className="text-balance font-display text-[clamp(1.8rem,3.2vw,2.5rem)] font-semibold leading-[1.08] text-ink">
                An honest setter, not a closer
              </h2>
              <p className="mt-5 max-w-[38ch] text-[15px] leading-relaxed text-ink-2">
                The assistant is booking a visit, not selling a system. These are enforced in code,
                not asked for politely in an instruction.
              </p>
            </div>

            <dl className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
              {LIMITS.map(({ title, copy }) => (
                <div key={title} className="flex gap-3.5">
                  <ShieldWarningIcon
                    className="mt-0.5 size-5 shrink-0 text-accent"
                    weight="duotone"
                    aria-hidden="true"
                  />
                  <div>
                    <dt className="text-[14.5px] font-semibold text-ink">{title}</dt>
                    <dd className="mt-1.5 max-w-[42ch] text-[13.5px] leading-relaxed text-ink-2">
                      {copy}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Close ────────────────────────────────────────────────────────
            One line and a route back to the console. Nothing new is
            introduced this far down the page. */}
        <section className="mx-auto max-w-6xl px-5 py-20 text-center sm:px-8">
          <h2 className="mx-auto max-w-[20ch] text-balance font-display text-[clamp(1.7rem,3vw,2.3rem)] font-semibold leading-[1.1] text-ink">
            It takes about two minutes.
          </h2>
          <a
            href="#console"
            className="press mt-7 inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 text-[15px] font-semibold text-paper shadow-lift hover:bg-accent-deep"
          >
            <CalendarCheckIcon className="size-4.5" weight="bold" />
            Start the call
          </a>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="inline-flex items-center gap-2.5 text-[13px] text-ink-3">
            <LogoMark className="size-5" />
            Calls are recorded and transcribed with consent.
          </p>
          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]"
          >
            <Link href="/privacy" className="text-ink-3 transition-colors hover:text-accent">
              Privacy
            </Link>
            <Link href="/terms" className="text-ink-3 transition-colors hover:text-accent">
              Terms
            </Link>
            <Link
              href="/dashboard"
              className="font-medium text-ink-2 transition-colors hover:text-accent"
            >
              Admin dashboard
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
