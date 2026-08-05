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

describe('assistant phrasing', () => {
  it('strips a help-desk offer but keeps the real content', () => {
    const result = applyGuardrails(
      "Certainly, I'd be happy to help with that. What's your average monthly bill?",
    );

    expect(result.blocked).toBe(false);
    expect(result.text).toBe("What's your average monthly bill?");
    expect(result.violations.map((v) => v.rule)).toContain('assistant_phrasing');
  });

  it('strips the sign-off a help desk uses and a setter never would', () => {
    const result = applyGuardrails('That works. Is there anything else I can help you with?');
    expect(result.text).toBe('That works.');
  });

  it('leaves an ordinary agreement alone', () => {
    const line = 'Absolutely, a lot of people say the same thing.';
    expect(applyGuardrails(line).text).toBe(line);
  });

  it('blocks a reply that was nothing but stock phrasing', () => {
    const result = applyGuardrails('How can I assist you today?');
    expect(result.blocked).toBe(true);
    expect(result.violations.map((v) => v.rule)).toContain('empty_reply');
  });
});

describe('invented partnerships', () => {
  it.each([
    'PG&E is one of our partner providers.',
    "That's one of the providers we work with.",
    "Oh, PG&E. That's one of the most common providers we work with.",
    'They are one of the utilities we partner with.',
    'We work directly with your utility on this.',
  ])('blocks %j', (reply) => {
    // The knowledge base describes no arrangement with any utility, so every
    // one of these is a product fact the model made up. All three of the first
    // three were said out loud during end-to-end testing.
    const result = applyGuardrails(reply);
    expect(result.blocked).toBe(true);
    expect(result.violations.map((v) => v.rule)).toContain('invented_partnership');
  });

  it.each([
    "We're working with a few of your neighbours about the rate increases.",
    "The program we're working with is government sponsored.",
    'Who is your current electricity provider?',
  ])('leaves %j alone', (reply) => {
    // The rule targets a claimed relationship with a *utility*. Working a
    // neighbourhood and naming the program are both in the script.
    expect(applyGuardrails(reply).blocked).toBe(false);
  });
});

describe('phone vocabulary', () => {
  it.each([
    ['We can chat it through when the engineer comes out.', 'talk'],
    ['I just wanted to chat about your bill.', 'talk'],
    ['We were chatting with your neighbours yesterday.', 'talking'],
    ['I chatted with a few homeowners on your street.', 'spoke'],
  ])('rewrites chat-window vocabulary in %j', (reply, expected) => {
    const result = applyGuardrails(reply);
    expect(result.text).not.toMatch(/\bchat/i);
    expect(result.text).toMatch(new RegExp(expected, 'i'));
  });

  it('turns "a quick chat" into something a person would actually say', () => {
    expect(applyGuardrails('I just need a quick chat.').text).toBe('I just need a quick word.');
  });

  it.each([
    'Is this a good time? We are working on your street this week.',
    'Sorry to bother you. We are working on your street this week.',
    'Do you have a minute? We are working on your street this week.',
    'Could I steal a moment of your time? We are working on your street this week.',
    'Is this a good time to chat? We are working on your street this week.',
  ])('drops the permission ask in %j', (reply) => {
    const result = applyGuardrails(reply);

    expect(result.text).not.toMatch(/good time|sorry to bother|have a minute|steal a moment/i);
    // The sentence that carried the actual content survives.
    expect(result.text).toMatch(/working on your street/i);
    expect(result.violations.map((v) => v.rule)).toContain('assistant_phrasing');
  });

  it('leaves a real apology for something that happened alone', () => {
    // The rule targets apologising for the call itself, not ordinary manners.
    const line = "Sorry, I didn't catch that.";
    expect(applyGuardrails(line).text).toBe(line);
  });

  it('leaves the AIR response to "I am busy" intact', () => {
    // objection-handling.md: agree, then resume. It offers to be brief; it does
    // not ask to be allowed to continue.
    const line = "Of course, I get that. I'll keep this super short.";
    expect(applyGuardrails(line).text).toBe(line);
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
