import { describe, expect, it } from 'vitest';
import { redact } from '../src/lib/logger.js';

/**
 * claude.md §11 forbids exposing keys, prompts, and credentials. Logs are the
 * easiest place for those to escape, so redaction gets its own tests.
 */
describe('redact', () => {
  it('replaces secret-bearing keys entirely', () => {
    const out = redact({
      apiKey: 'glm-super-secret',
      authorization: 'Bearer abc123',
      service_role_key: 'srk_live_xyz',
      password: 'hunter2',
      model: 'glm-4.5-flash',
    }) as Record<string, unknown>;

    expect(out['apiKey']).toBe('[redacted]');
    expect(out['authorization']).toBe('[redacted]');
    expect(out['service_role_key']).toBe('[redacted]');
    expect(out['password']).toBe('[redacted]');
    // Non-secret context must survive, or the logs are useless.
    expect(out['model']).toBe('glm-4.5-flash');
  });

  it('masks PII but keeps the last four characters for correlation', () => {
    const out = redact({
      phone: '+15551234567',
      email: 'homeowner@example.com',
      address: '1600 Pennsylvania Ave',
    }) as Record<string, unknown>;

    expect(out['phone']).toBe('***4567');
    expect(out['email']).toBe('***.com');
    expect(String(out['address'])).not.toContain('Pennsylvania');
  });

  it('redacts nested structures', () => {
    const out = redact({
      call: { id: 'c1', lead: { name: 'Sam', phone: '+15559998888' } },
      headers: { authorization: 'Bearer nope' },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect(out['call']?.['lead']?.['phone']).toBe('***8888');
    // A name is not in the PII key list — it appears in transcripts anyway and
    // is needed to make logs readable.
    expect(out['call']?.['lead']?.['name']).toBe('Sam');
    expect(out['headers']?.['authorization']).toBe('[redacted]');
  });

  it('stops at a depth limit instead of recursing forever', () => {
    // A cyclic payload must not hang the logger mid-call.
    const cyclic: Record<string, unknown> = { level: 0 };
    cyclic['self'] = cyclic;

    expect(() => redact(cyclic)).not.toThrow();
    expect(JSON.stringify(redact(cyclic))).toContain('depth limit');
  });

  it('reduces an Error to name and message, dropping the stack', () => {
    const out = redact(new Error('boom')) as Record<string, unknown>;
    expect(out).toEqual({ name: 'Error', message: 'boom' });
  });
});
