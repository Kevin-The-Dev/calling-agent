import { describe, expect, it } from 'vitest';
import { applyGuardrails, countQuestions, safeFallback } from '../src/agents/guardrails.js';

describe('placeholder guardrail', () => {
  // The case this rule exists for: caught in end-to-end testing, spoken aloud
  // as the opening line of a call.
  it('blocks an unfilled name placeholder', () => {
    const result = applyGuardrails("Hi there, is this [Homeowner's Name]?");

    expect(result.blocked).toBe(true);
    expect(result.violations.map((v) => v.rule)).toContain('unfilled_placeholder');
  });

  it.each([
    'Is this [Name]?',
    'I have you at {address} — is that right?',
    'Your provider is [UTILITY_PROVIDER], correct?',
  ])('blocks %j', (reply) => {
    expect(applyGuardrails(reply).blocked).toBe(true);
  });

  it('leaves ordinary parenthetical speech alone', () => {
    const result = applyGuardrails('We can absolutely do that (whenever suits you best).');

    expect(result.blocked).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  it('does not fire on a bare bracket pair with nothing template-like inside', () => {
    // Two characters is the floor, so "[]" and "[a]" stay out of scope.
    expect(applyGuardrails('That saves you [] nothing at all.').blocked).toBe(false);
  });
});

describe('banned claims', () => {
  it.each([
    ["you're approved", 'promises_approval'],
    ['I guarantee it', 'guarantees_outcome'],
    ['your roof will be free', 'promises_free_roof'],
    ['we are with the government', 'false_affiliation'],
    ['no credit check', 'false_credit_claim'],
  ])('blocks %j', (reply, rule) => {
    const result = applyGuardrails(reply);

    expect(result.blocked).toBe(true);
    expect(result.violations.map((v) => v.rule)).toContain(rule);
  });

  it('allows the sanctioned savings range', () => {
    expect(applyGuardrails('It works out 20 to 50% cheaper than what you pay now.').blocked).toBe(
      false,
    );
  });

  it('blocks the wrong savings range', () => {
    expect(applyGuardrails('You could see 30 to 50% off your bill.').blocked).toBe(true);
  });
});

describe('one question per turn', () => {
  it('truncates a reply carrying two real questions', () => {
    const result = applyGuardrails('What is your bill? And who is your provider?');

    expect(result.blocked).toBe(false);
    expect(result.text).toBe('What is your bill?');
    expect(result.violations.map((v) => v.rule)).toContain('multiple_questions');
  });

  it('treats a confirmation tag as part of the same ask', () => {
    expect(countQuestions('That is about right, correct?')).toBe(1);
  });

  it('leaves the closing recap intact when the rule is relaxed', () => {
    const recap = 'The engineer comes Tuesday at two. Have your bill ready. Sound good?';
    const result = applyGuardrails(recap, { enforceOneQuestion: false });

    expect(result.text).toBe(recap);
  });
});

describe('internal-machinery leaks', () => {
  // The words "opening", "qualification" and "rapport" were blocked outright,
  // which discarded the most important line of the whole call and replaced it
  // with the "I'm not 100% sure" fallback, mid-booking.
  it('lets the agent offer an appointment slot', () => {
    const result = applyGuardrails('I have an opening this Thursday at two. Does that work?');
    expect(result.blocked).toBe(false);
    expect(result.text).toMatch(/opening/);
  });

  it('lets the agent describe qualification in plain English', () => {
    expect(applyGuardrails('The qualification only takes a couple of minutes.').blocked).toBe(false);
  });

  it('still blocks the internal stage identifiers', () => {
    expect(applyGuardrails('Moving to value_pitch now.').blocked).toBe(true);
    expect(applyGuardrails('That was the objection_handling step.').blocked).toBe(true);
  });

  it('still blocks talk of the conversation being staged', () => {
    expect(applyGuardrails('We are at the current stage of my process.').blocked).toBe(true);
  });
});

describe('safeFallback', () => {
  it('varies with the turn count so a repeat hit is not a robotic loop', () => {
    expect(safeFallback(0)).not.toBe(safeFallback(1));
  });

  it('always returns a line', () => {
    for (let i = 0; i < 10; i += 1) expect(safeFallback(i).length).toBeGreaterThan(0);
  });
});
