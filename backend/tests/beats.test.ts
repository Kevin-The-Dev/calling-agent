/**
 * Delivered-beat detection.
 *
 * These two beats are statements rather than questions, so nothing in the lead
 * record shows whether they happened. Both were caught going missing in
 * end-to-end testing — see agents/beats.ts.
 */
import { describe, expect, it } from 'vitest';
import { beatsFromHistory, beatsInReply, mergeBeats, NO_BEATS } from '../src/agents/beats.js';
import type { TranscriptTurn } from '../src/types/domain.js';

describe('SGIP detection', () => {
  it.each([
    'It qualifies you for a program called SGIP.',
    'It’s the Self-Generation Incentive Program, government backed.',
    'They call it the self generation incentive program.',
    'We check whether the home is eligible for S.G.I.P.',
  ])('recognises %j as the program being named', (reply) => {
    expect(beatsInReply(reply).sgip).toBe(true);
  });

  it.each([
    'We work with a few of your neighbours about the rate increases.',
    'Did you get the letter that went out to your address?',
    'There is a government program that might help with the bill.',
  ])('does not accept %j as having named it', (reply) => {
    // A vague gesture at "a government program" is exactly the substitution the
    // stage instructions forbid, and the gate exists to catch it.
    expect(beatsInReply(reply).sgip).toBe(false);
  });
});

describe('bill-swap detection', () => {
  it.each([
    'That payment is 20 to 50% cheaper than what you pay now.',
    'It works out 20-50 percent cheaper.',
    'This is designed to reduce that bill down to zero.',
    'All you would be paying for is the solar equipment.',
    "It's cheaper than you're paying right now, and it never goes up.",
  ])('recognises %j as the pitch', (reply) => {
    expect(beatsInReply(reply).pitch).toBe(true);
  });

  it.each([
    'Solar can be a really good fit for a home like yours.',
    'A lot of your neighbours have gone ahead with it.',
    'The engineer will go through the numbers with you.',
  ])('does not accept %j as the pitch', (reply) => {
    expect(beatsInReply(reply).pitch).toBe(false);
  });
});

describe('accumulation', () => {
  it('never un-delivers a beat', () => {
    const after = mergeBeats({ sgip: true, pitch: false, phoneAsked: false, emailAsked: false, recap: false }, 'And who is your provider?');
    expect(after.sgip).toBe(true);
  });

  it('rebuilds from the transcript so a cache miss does not repeat a beat', () => {
    const history: TranscriptTurn[] = [
      { speaker: 'prospect', content: 'Yeah I own it.', stage: 'opening' },
      { speaker: 'agent', content: 'It is a program called SGIP.', stage: 'rapport' },
      { speaker: 'prospect', content: 'Never heard of it.', stage: 'rapport' },
    ];

    expect(beatsFromHistory(history)).toEqual({ sgip: true, pitch: false, phoneAsked: false, emailAsked: false, recap: false });
  });

  it('ignores the prospect saying it — only the agent can deliver a beat', () => {
    const history: TranscriptTurn[] = [
      { speaker: 'prospect', content: 'My brother mentioned SGIP to me.', stage: 'rapport' },
    ];

    expect(beatsFromHistory(history)).toEqual(NO_BEATS);
  });
});

describe('contact asks', () => {
  it.each([
    'Just in case we get cut off, what is the best number to reach you?',
    "And what's a good phone number for you?",
    "What's the best cell to text you on?",
  ])('recognises a phone ask: "%s"', (reply) => {
    expect(beatsInReply(reply).phoneAsked).toBe(true);
  });

  it.each([
    'What would you say your average monthly bill is?',
    'Got it, so the number on your bill is around two forty.',
    'I will put a note down about your phone.',
  ])('does not mistake "%s" for a phone ask', (reply) => {
    expect(beatsInReply(reply).phoneAsked).toBe(false);
  });

  it('recognises an email ask, and only as a question', () => {
    expect(beatsInReply("What's a good email to send the details over to?").emailAsked).toBe(true);
    expect(beatsInReply("No problem, we'll skip the email.").emailAsked).toBe(false);
  });

  it('rebuilds asks from the transcript so a cache miss does not ask again', () => {
    const history: TranscriptTurn[] = [
      { speaker: 'agent', content: 'And the best number to reach you?', stage: 'opening' },
      { speaker: 'prospect', content: "I'd rather not.", stage: 'opening' },
    ];
    expect(beatsFromHistory(history).phoneAsked).toBe(true);
    expect(beatsFromHistory(history).emailAsked).toBe(false);
  });
});
