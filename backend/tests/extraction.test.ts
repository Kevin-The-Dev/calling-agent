/**
 * Extraction normalization.
 *
 * The extractor puts the appointment fields inside `lead_patch` roughly half
 * the time. `leadSchema.partial()` then strips them without complaint, so a
 * booking the prospect had verbally agreed to disappeared before anything saw
 * it — no error, no log, just an appointment row that never got written.
 */
import { describe, expect, it } from 'vitest';
import { normalizeExtraction } from '../src/agents/turn-engine.js';
import { extractionSchema } from '../src/types/domain.js';

const parse = (raw: unknown) => extractionSchema.parse(normalizeExtraction(raw));

describe('normalizeExtraction', () => {
  it('rescues an appointment the model buried in lead_patch', () => {
    const result = parse({
      lead_patch: {
        phone: '5105551212',
        appointment_date: '2026-08-11',
        appointment_time: '14:00',
        appointment_conflict_checked: true,
      },
    });

    expect(result.appointment_date).toBe('2026-08-11');
    expect(result.appointment_time).toBe('14:00');
    expect(result.appointment_conflict_checked).toBe(true);
    // The real lead field is untouched.
    expect(result.lead_patch.phone).toBe('5105551212');
  });

  it('leaves a correctly-shaped extraction alone', () => {
    const result = parse({
      lead_patch: { name: 'Dave' },
      appointment_date: '2026-08-11',
      appointment_time: '09:30',
    });

    expect(result.appointment_date).toBe('2026-08-11');
    expect(result.lead_patch.name).toBe('Dave');
  });

  it('prefers the correctly-placed value when the model sends both', () => {
    const result = parse({
      lead_patch: { appointment_date: '2026-01-01' },
      appointment_date: '2026-08-11',
    });

    expect(result.appointment_date).toBe('2026-08-11');
  });

  it('accepts a single-digit hour, which is how a model writes "two o\'clock"', () => {
    expect(parse({ lead_patch: {}, appointment_time: '9:30' }).appointment_time).toBe('9:30');
  });

  it('passes through anything that is not an extraction object', () => {
    expect(normalizeExtraction(null)).toBeNull();
    expect(normalizeExtraction('nope')).toBe('nope');
    expect(normalizeExtraction({ lead_patch: 'not an object' })).toEqual({
      lead_patch: 'not an object',
    });
  });
});
