/**
 * Local wall-clock → instant.
 *
 * The extractor reports what was said out loud ("Thursday at two"), so the
 * server owns the timezone arithmetic. Getting it wrong sends an engineer to a
 * house an hour early, which is the kind of bug that only shows up in the field.
 */
import { describe, expect, it } from 'vitest';
import { describeLocalTime, isBookable, resolveLocalTime } from '../src/lib/local-time.js';

describe('resolveLocalTime', () => {
  it('resolves a summer afternoon in Los Angeles (PDT, UTC-7)', () => {
    const at = resolveLocalTime('2026-08-06', '14:00', 'America/Los_Angeles');
    expect(at?.toISOString()).toBe('2026-08-06T21:00:00.000Z');
  });

  it('resolves the same wall clock in winter (PST, UTC-8)', () => {
    const at = resolveLocalTime('2026-01-15', '14:00', 'America/Los_Angeles');
    expect(at?.toISOString()).toBe('2026-01-15T22:00:00.000Z');
  });

  it('handles a zone with a half-hour offset', () => {
    const at = resolveLocalTime('2026-08-06', '09:30', 'Asia/Kolkata');
    expect(at?.toISOString()).toBe('2026-08-06T04:00:00.000Z');
  });

  it('handles a zone across the date line', () => {
    const at = resolveLocalTime('2026-08-06', '09:00', 'Australia/Sydney');
    expect(at?.toISOString()).toBe('2026-08-05T23:00:00.000Z');
  });

  it('survives the morning a zone springs forward', () => {
    // US DST begins 2026-03-08. 14:00 local that day is PDT, UTC-7.
    const at = resolveLocalTime('2026-03-08', '14:00', 'America/Los_Angeles');
    expect(at?.toISOString()).toBe('2026-03-08T21:00:00.000Z');
  });

  it('rejects anything that is not a real date or time', () => {
    expect(resolveLocalTime('Thursday', '14:00', 'America/Los_Angeles')).toBeNull();
    expect(resolveLocalTime('2026-08-06', '2pm', 'America/Los_Angeles')).toBeNull();
    expect(resolveLocalTime('2026-13-06', '14:00', 'America/Los_Angeles')).toBeNull();
    expect(resolveLocalTime('2026-08-06', '25:00', 'America/Los_Angeles')).toBeNull();
  });
});

describe('describeLocalTime', () => {
  it('reads an instant back the way it was agreed', () => {
    const spoken = describeLocalTime(
      new Date('2026-08-06T21:00:00.000Z'),
      'America/Los_Angeles',
    );
    expect(spoken).toMatch(/Thursday, August 6/);
    expect(spoken).toMatch(/2:00/);
  });

  it('round-trips a resolved slot', () => {
    const at = resolveLocalTime('2026-08-06', '14:00', 'America/Los_Angeles');
    expect(describeLocalTime(at as Date, 'America/Los_Angeles')).toMatch(/Thursday, August 6.*2:00/);
  });
});

describe('isBookable', () => {
  const NOW = new Date('2026-08-05T18:00:00Z'); // Wednesday afternoon in LA
  const ZONE = 'America/Los_Angeles';

  it('accepts tomorrow afternoon', () => {
    const slot = resolveLocalTime('2026-08-06', '14:00', ZONE) as Date;
    expect(isBookable(slot, NOW, ZONE)).toEqual({ ok: true });
  });

  // Caught in an end-to-end run: the agent agreed to "Wednesday at 2pm" on a
  // Wednesday, booking a slot that was already in the past.
  it('rejects today, even later today', () => {
    const slot = resolveLocalTime('2026-08-05', '20:00', ZONE) as Date;
    expect(isBookable(slot, NOW, ZONE)).toEqual({ ok: false, reason: 'today' });
  });

  it('rejects a slot already gone', () => {
    const slot = resolveLocalTime('2026-08-04', '14:00', ZONE) as Date;
    expect(isBookable(slot, NOW, ZONE)).toEqual({ ok: false, reason: 'in_the_past' });
  });

  it('rejects beyond the two-week horizon', () => {
    const slot = resolveLocalTime('2026-09-15', '14:00', ZONE) as Date;
    expect(isBookable(slot, NOW, ZONE)).toEqual({ ok: false, reason: 'beyond_horizon' });
  });

  it('accepts the last day inside the horizon', () => {
    const slot = resolveLocalTime('2026-08-19', '10:00', ZONE) as Date;
    expect(isBookable(slot, NOW, ZONE)).toEqual({ ok: true });
  });
});
