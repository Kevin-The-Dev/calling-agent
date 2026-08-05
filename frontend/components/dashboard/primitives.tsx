/**
 * Dashboard primitives.
 *
 * Small, shared, and deliberately unclever. The dashboard's job is to make a
 * call legible at a glance, which means every score, band, and outcome must
 * look the same everywhere it appears — a "hot" lead cannot be red on one page
 * and orange on another.
 */
import type { ReactNode } from 'react';

/* ── Tone map ──────────────────────────────────────────────────────────────
 * One place that decides what a status *looks* like. Everything downstream
 * asks here rather than picking its own colour.
 */
export type Tone = 'neutral' | 'solar' | 'live' | 'think' | 'alert' | 'pine';

const TONE_STYLE: Record<Tone, { color: string; background: string; borderColor: string }> = {
  neutral: {
    color: 'var(--color-ink-2)',
    background: 'var(--color-sunk)',
    borderColor: 'var(--color-line)',
  },
  solar: {
    color: 'var(--color-solar-deep)',
    background: 'var(--color-solar-wash)',
    borderColor: 'var(--color-solar-line)',
  },
  live: {
    color: 'var(--color-live)',
    background: 'var(--color-live-wash)',
    borderColor: 'color-mix(in srgb, var(--color-live) 25%, transparent)',
  },
  think: {
    color: 'var(--color-think)',
    background: 'var(--color-think-wash)',
    borderColor: 'color-mix(in srgb, var(--color-think) 25%, transparent)',
  },
  alert: {
    color: 'var(--color-alert)',
    background: 'var(--color-alert-wash)',
    borderColor: 'color-mix(in srgb, var(--color-alert) 25%, transparent)',
  },
  pine: {
    color: 'var(--color-pine)',
    background: 'var(--color-pine-wash)',
    borderColor: 'color-mix(in srgb, var(--color-pine) 22%, transparent)',
  },
};

/** A booked call is the only outcome worth celebrating, so only it gets pine. */
export const OUTCOME_TONE: Record<string, Tone> = {
  booked: 'pine',
  callback: 'solar',
  not_interested: 'neutral',
  disqualified: 'neutral',
  do_not_contact: 'alert',
  abandoned: 'neutral',
  error: 'alert',
};

export const BAND_TONE: Record<string, Tone> = {
  hot: 'solar',
  warm: 'think',
  cold: 'neutral',
  unqualified: 'neutral',
};

export const STATUS_TONE: Record<string, Tone> = {
  new: 'neutral',
  qualifying: 'think',
  qualified: 'solar',
  booked: 'pine',
  disqualified: 'neutral',
  do_not_contact: 'alert',
};

/** Turns `do_not_contact` into "Do not contact" for display. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-medium ${className}`}
      style={TONE_STYLE[tone]}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-line bg-surface shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHead({
  title,
  icon,
  action,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
      <h2 className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-ink">
        {icon}
        {title}
      </h2>
      {action}
    </div>
  );
}

/**
 * A headline number.
 *
 * `hint` carries the comparison that makes the number mean something — a
 * booking count without a call count is trivia.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-sm transition-shadow hover:shadow-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-3">{label}</p>
        {icon && (
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg border"
            style={TONE_STYLE[tone]}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="tnum mt-3 font-display text-[2rem] font-semibold leading-none text-ink">
        {value}
      </p>
      {hint && <p className="mt-2 text-[12.5px] text-ink-3">{hint}</p>}
    </div>
  );
}

/** Empty states say what will fill the space, not just that it is empty. */
export function EmptyState({ icon, title, copy }: { icon?: ReactNode; title: string; copy: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <span className="mb-1 text-ink-4">{icon}</span>}
      <p className="text-[14px] font-medium text-ink-2">{title}</p>
      <p className="max-w-xs text-[13px] leading-relaxed text-ink-3">{copy}</p>
    </div>
  );
}

/**
 * A 0–100 qualification score as a bar plus the number.
 * The bar is what makes fifty rows scannable; the number is what makes one row
 * actionable.
 */
export function ScoreBar({ score, band }: { score: number; band?: string | null }) {
  // Calls carry a score but no band, so derive one rather than rendering every
  // bar in the same neutral ink — the colour is what makes a list scannable.
  const tone = band
    ? (BAND_TONE[band] ?? 'neutral')
    : score >= 70
      ? 'solar'
      : score >= 50
        ? 'think'
        : 'neutral';
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-line">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.min(100, Math.max(0, score))}%`,
            background: TONE_STYLE[tone].color,
          }}
        />
      </span>
      <span className="tnum w-7 text-right text-[13px] font-medium text-ink">{score}</span>
    </span>
  );
}

/** Seconds → "4:07". Durations are read as minutes, never as 247. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
