/**
 * Local wall-clock time → a real instant.
 *
 * The extractor reports the agreed appointment as a local date and a local time
 * ("2026-08-06", "14:00") because that is what was actually said out loud, and
 * because a model asked for a full ISO instant produces a confident, wrong UTC
 * offset — it does not know whether the prospect's zone is on daylight time
 * that week.
 *
 * So the server does the arithmetic. There is no `Date` constructor that takes
 * a wall-clock time plus an IANA zone, so this finds the offset by formatting a
 * guess back into the target zone and correcting by the difference. Two passes
 * because the first correction can itself cross a DST boundary.
 */

/** The offset, in minutes, that `zone` was at the given instant. */
function offsetMinutesAt(instant: Date, zone: string): number {
  // `en-US` with these options gives a parseable, stable shape in every runtime
  // that ships full ICU, which Node 20+ and Vercel both do.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );

  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * Resolves a local date and time in `zone` to an instant.
 * Returns null when the inputs are not a real date — the caller treats that as
 * "no appointment agreed" rather than booking something nonsensical.
 */
export function resolveLocalTime(date: string, time: string, zone: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch.map(Number) as [number, number, number, number];
  const [, hour, minute] = timeMatch.map(Number) as [number, number, number];

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  // Start by pretending the wall clock is UTC, then subtract the zone's offset.
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let pass = 0; pass < 2; pass += 1) {
    const offset = offsetMinutesAt(guess, zone);
    const corrected = new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 60_000);
    if (corrected.getTime() === guess.getTime()) break;
    guess = corrected;
  }

  return Number.isNaN(guess.getTime()) ? null : guess;
}

/**
 * Whether a resolved slot is one the agent was allowed to book.
 *
 * appointment-booking.md §3: earliest is the next calendar day, horizon is
 * fourteen days. Checked server-side because the model does book outside it —
 * caught in an end-to-end run where it agreed to "Wednesday at 2pm" on a
 * Wednesday, producing an appointment in the past by the time anyone read it.
 */
export function isBookable(
  slot: Date,
  now: Date,
  zone: string,
  horizonDays = 14,
): { ok: true } | { ok: false; reason: 'in_the_past' | 'today' | 'beyond_horizon' } {
  if (slot.getTime() <= now.getTime()) return { ok: false, reason: 'in_the_past' };

  const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(d);
  if (localDay(slot) === localDay(now)) return { ok: false, reason: 'today' };

  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  if (slot.getTime() > horizon.getTime()) return { ok: false, reason: 'beyond_horizon' };

  return { ok: true };
}

/** How a person would say an instant out loud, in their own timezone. */
export function describeLocalTime(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  }).format(instant);
}
