/**
 * Prompt assembly.
 *
 * These cover the contact details the agent starts a web call knowing nothing
 * about — name, address, phone, email. None of them were ever asked for, and
 * because two of them gate qualification the call could not progress past it.
 */
import { describe, expect, it } from 'vitest';
import { buildExtractorPrompt, buildSystemPrompt } from '../src/knowledge/prompt-builder.js';
import type { AgentIdentity } from '../src/knowledge/prompt-builder.js';
import type { CallState, Lead, Stage } from '../src/types/domain.js';

const IDENTITY: AgentIdentity = {
  companyName: 'Helio Energy',
  agentName: 'Sam',
  consultantName: 'Dana',
  serviceArea: 'the East Bay',
  callbackNumber: undefined,
};

function makeState(stage: Stage, lead: Lead = {}): CallState {
  return {
    callId: 'call-1',
    leadId: 'lead-1',
    stage,
    returnStage: null,
    turnCount: 3,
    earlyObjectionCount: 0,
    lateObjectionCount: 0,
    consecutiveFallbacks: 0,
    lead,
    objections: [],
    qualificationScore: 0,
    qualificationBand: 'unqualified',
    buyingIntent: 'low',
    disqualifiedReason: null,
    doNotContact: false,
    outcome: null,
  };
}

const build = (stage: Stage, lead: Lead = {}, now?: Date) =>
  buildSystemPrompt({
    state: makeState(stage, lead),
    identity: IDENTITY,
    objection: null,
    ...(now ? { now } : {}),
  });

describe('contact capture', () => {
  it('asks for the name in the opening when none is known', () => {
    const prompt = build('opening');
    expect(prompt).toMatch(/STILL TO GET/);
    expect(prompt).toMatch(/1\. their name/);
  });

  it('drops the name once it is known and moves to the next thing', () => {
    const prompt = build('opening', { name: 'Dave' });
    expect(prompt).not.toMatch(/1\. their name/);
    expect(prompt).toMatch(/whether they are the homeowner/);
  });

  it('asks for the address during qualification', () => {
    const prompt = build('qualification', { name: 'Dave', monthly_bill: 240 });
    expect(prompt).toMatch(/the property address/);
  });

  it('asks for the phone number and email while locking the appointment', () => {
    const prompt = build('confirmation', { name: 'Dave', address: '12 Oak St' });
    expect(prompt).toMatch(/phone number to text the confirmation to/);
    expect(prompt).toMatch(/email address/);
  });

  it('stops asking for contact details once every one is known', () => {
    const prompt = build('confirmation', {
      name: 'Dave',
      address: '12 Oak St',
      phone: '5105551212',
      email: 'dave@example.com',
    });
    expect(prompt).not.toMatch(/STILL TO GET/);
  });

  it('keeps asking for the outstanding detail through an objection', () => {
    const prompt = buildSystemPrompt({
      state: {
        ...makeState('objection_handling', { name: 'Dave' }),
        returnStage: 'qualification',
      },
      identity: IDENTITY,
      objection: null,
    });
    expect(prompt).toMatch(/the property address/);
  });

  it('tells the extractor how a name, phone and email arrive in speech', () => {
    const prompt = buildExtractorPrompt(makeState('qualification'));
    expect(prompt).toMatch(/Normalize to digits only/);
    expect(prompt).toMatch(/"at" means @/);
    expect(prompt).toMatch(/relationship\s+"self"/);
  });
});

describe('calendar awareness', () => {
  // A Wednesday, so "tomorrow" and "+14 days" are both unambiguous.
  const NOW = new Date('2026-08-05T18:00:00Z');

  it('gives the agent today, the earliest slot, and the horizon when booking', () => {
    const prompt = build('appointment', { timezone: 'America/Los_Angeles' }, NOW);
    expect(prompt).toMatch(/Today is Wednesday, August 5/);
    expect(prompt).toMatch(/earliest you may offer is tomorrow, Thursday, August 6/);
    expect(prompt).toMatch(/The latest is Wednesday, August 19/);
  });

  it('renders the date in the lead’s timezone, not the server’s', () => {
    // 18:00 UTC is still the 5th in Los Angeles but already the 6th in Sydney.
    const prompt = build('appointment', { timezone: 'Australia/Sydney' }, NOW);
    expect(prompt).toMatch(/Today is Thursday, August 6/);
  });

  it('omits the calendar before there is any reason to speak a date', () => {
    expect(build('qualification')).not.toMatch(/RIGHT NOW/);
    expect(build('appointment')).toMatch(/RIGHT NOW/);
  });
});
