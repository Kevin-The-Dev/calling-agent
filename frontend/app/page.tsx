import Link from 'next/link';
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarCheck,
  CircleDollarSign,
  Ear,
  Gauge,
  Handshake,
  Home,
  MessageSquareQuote,
  Mic,
  Radio,
  ShieldAlert,
  Sun,
  Users,
  Zap,
} from 'lucide-react';
import { CallConsole } from '@/components/call-console';
import { SystemStatus } from '@/components/system-status';
import { LogoMark, WordmarkLink } from '@/components/brand';

/**
 * The main page.
 *
 * The console is the product, so it is placed where the eye lands first and
 * everything else explains what just happened. The supporting sections are
 * drawn from what the agent genuinely does — the eight stages below are the
 * server's state machine, and the captured fields are the real lead object —
 * because a page that describes a different product than the one running on it
 * is worse than no page.
 */

const STAGES = [
  { icon: Handshake, label: 'Opening', copy: 'Confirms it is the homeowner, by name.' },
  { icon: MessageSquareQuote, label: 'Reason', copy: 'The neighbourhood rate complaint and SGIP.' },
  { icon: Ear, label: 'Qualifying', copy: 'Bill, roof, ownership, credit band — one at a time.' },
  { icon: Zap, label: 'Discovery', copy: 'Makes the bill feel real before any pitch.' },
  { icon: Sun, label: 'Value', copy: 'The bill swap, in their own numbers.' },
  { icon: CalendarCheck, label: 'Booking', copy: 'Narrows the window, then offers one time.' },
  { icon: BadgeCheck, label: 'Confirm', copy: 'Conflicts, decision makers, best number.' },
  { icon: Radio, label: 'Recap', copy: 'Five points, then a warm sign-off.' },
];

const CAPTURED = [
  { icon: Home, label: 'Property', fields: 'Address · home type · roof · shading · ownership' },
  { icon: CircleDollarSign, label: 'Bill', fields: 'Monthly spend · utility provider · pain points' },
  { icon: Users, label: 'People', fields: 'Name · contact · decision makers who must attend' },
  { icon: Gauge, label: 'Scoring', fields: 'Qualification band · buying intent · objections raised' },
];

const GUARDRAILS = [
  'Never promises approval, a dollar figure, or a free roof.',
  'Savings are only ever described as 20–50% cheaper.',
  'Says plainly that it is an AI whenever it is asked.',
  'A removal request stops the call immediately — no rebuttal.',
];

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden texture-grain">
      {/* Atmosphere: a warm light source off the top-right, drifting slowly.
          Fixed and behind everything, so scrolling moves content through it. */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -right-[15%] -top-[30%] size-[70rem] rounded-full opacity-70 animate-drift"
          style={{
            background:
              'radial-gradient(circle, var(--color-solar-wash) 0%, rgba(253,239,223,0.45) 38%, transparent 68%)',
          }}
        />
        <div
          className="absolute -left-[20%] top-[45%] size-[45rem] rounded-full opacity-60"
          style={{
            background:
              'radial-gradient(circle, var(--color-pine-wash) 0%, transparent 65%)',
          }}
        />
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
          <WordmarkLink />

          <div className="hidden items-center gap-7 text-[13.5px] text-ink-2 md:flex">
            <a href="#how" className="transition-colors hover:text-solar-deep">
              How it runs
            </a>
            <a href="#captures" className="transition-colors hover:text-solar-deep">
              What it captures
            </a>
            <a href="#guardrails" className="transition-colors hover:text-solar-deep">
              Guardrails
            </a>
          </div>

          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-[13.5px] font-medium shadow-sm transition-all hover:border-line-strong hover:shadow-card"
          >
            Dashboard
            <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </nav>
      </header>

      <main>
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 pb-20 pt-12 sm:px-8 lg:pb-28 lg:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_minmax(0,26rem)] lg:gap-16">
            <div className="stagger">
              <span className="inline-flex items-center gap-2 rounded-full border border-solar-line bg-solar-wash px-3 py-1.5 text-[12.5px] font-medium text-solar-deep">
                <span className="relative grid size-1.5 place-items-center">
                  <span className="absolute size-1.5 rounded-full bg-solar" />
                  <span className="absolute size-1.5 rounded-full bg-solar animate-halo" />
                </span>
                Live voice agent · SGIP programme
              </span>

              <h1 className="mt-6 font-display text-[clamp(2.6rem,6.5vw,4.4rem)] font-semibold leading-[0.98] text-ink">
                Find out if your
                <br />
                roof pays for
                <br />
                <span className="relative inline-block">
                  <span className="relative z-10 text-solar-deep">itself.</span>
                  {/* Hand-drawn underline: a flat rule would read as a link. */}
                  <svg
                    className="absolute -bottom-2 left-0 z-0 w-full"
                    height="12"
                    viewBox="0 0 200 12"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2 8.5C38 3.2 78 2.4 116 5.1c26 1.9 52 3.6 82 1.2"
                      fill="none"
                      stroke="var(--color-solar)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      opacity="0.45"
                    />
                  </svg>
                </span>
              </h1>

              <p className="mt-7 max-w-md text-[16.5px] leading-relaxed text-ink-2">
                Have a two-minute conversation with our assistant. It asks about your bill and your
                roof, and if your home qualifies it books a free consultation with an engineer —
                nothing to buy, nothing out of pocket.
              </p>

              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[13.5px] text-ink-2">
                {[
                  { icon: Mic, text: 'Speak, don’t type' },
                  { icon: CalendarCheck, text: 'Books in the call' },
                  { icon: ShieldAlert, text: 'Tells you it’s an AI' },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="inline-flex items-center gap-2">
                    <Icon className="size-4 text-solar" />
                    {text}
                  </li>
                ))}
              </ul>

              <div className="mt-10 max-w-md">
                <SystemStatus />
              </div>
            </div>

            {/* The console is nudged up and out of the text column so the two
                sit as overlapping planes rather than two tidy boxes. */}
            <div className="animate-rise lg:-mt-8">
              <CallConsole />
            </div>
          </div>
        </section>

        {/* ── How it runs ────────────────────────────────────────────────── */}
        <section id="how" className="border-y border-line bg-surface/60">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <SectionHead
              eyebrow="The conversation"
              title="Eight stages, never out of order"
              copy="The assistant holds its place in a real sales process. It cannot skip ahead to booking because someone sounded keen, and an objection is a detour it returns from — not a new direction."
            />

            <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {STAGES.map(({ icon: Icon, label, copy }, i) => (
                <li key={label} className="group bg-surface p-5 transition-colors hover:bg-solar-wash/50">
                  <div className="flex items-center justify-between">
                    <Icon className="size-5 text-solar transition-transform duration-300 group-hover:-translate-y-0.5" />
                    <span className="tnum font-display text-[15px] text-ink-4">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="mt-4 text-[14.5px] font-semibold text-ink">{label}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── What it captures ───────────────────────────────────────────── */}
        <section id="captures" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16">
            <SectionHead
              eyebrow="The record"
              title="Everything said, written down"
              copy="The assistant updates a live lead record after every answer, so nothing depends on anyone remembering. Transcripts and recordings land in the dashboard as the call ends."
              align="left"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              {CAPTURED.map(({ icon: Icon, label, fields }) => (
                <div
                  key={label}
                  className="group rounded-2xl border border-line bg-surface p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card"
                >
                  <span className="inline-grid size-9 place-items-center rounded-xl border border-solar-line bg-solar-wash">
                    <Icon className="size-4.5 text-solar-deep" />
                  </span>
                  <h3 className="mt-4 text-[14.5px] font-semibold">{label}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{fields}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Guardrails ─────────────────────────────────────────────────── */}
        <section id="guardrails" className="border-t border-line bg-ink text-paper">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1fr] lg:gap-20">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-solar">
                What it will not do
              </p>
              <h2 className="mt-4 font-display text-[clamp(1.9rem,3.6vw,2.8rem)] font-semibold leading-[1.05]">
                An honest setter, not a closer.
              </h2>
              <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-paper/65">
                The assistant is booking a visit, not selling a system. Where it does not know
                something, it says so and notes it for the engineer rather than filling the gap.
              </p>
            </div>

            <ul className="space-y-px self-center overflow-hidden rounded-2xl bg-paper/10">
              {GUARDRAILS.map((rule) => (
                <li
                  key={rule}
                  className="flex items-start gap-3 bg-ink px-5 py-4 text-[14px] leading-relaxed text-paper/85"
                >
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-solar" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link
            href="/"
            aria-label="Solarsetter — home"
            className="inline-flex items-center gap-2.5 text-[13px] text-ink-3 transition-opacity hover:opacity-70"
          >
            <LogoMark className="size-5" />
            Calls are recorded and transcribed with consent.
          </Link>
          <Link
            href="/dashboard"
            className="text-[13px] font-medium text-ink-2 transition-colors hover:text-solar-deep"
          >
            Admin dashboard →
          </Link>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  copy,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  copy: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-xl text-center' : 'max-w-sm'}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-solar-deep">
        {eyebrow}
      </p>
      <h2 className="mt-4 font-display text-[clamp(1.8rem,3.4vw,2.6rem)] font-semibold leading-[1.05] text-ink">
        {title}
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-2">{copy}</p>
    </div>
  );
}
