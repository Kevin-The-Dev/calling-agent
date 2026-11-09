/**
 * The short call: five questions (name, phone, homeowner, bill, address), the
 * offer, a time, a one-turn recap — and then it ends.
 */
import { describe, expect, it } from 'vitest';
import { beatsInReply, NO_BEATS } from '../src/agents/beats.js';
import { nextStage } from '../src/agents/state-machine.js';
import { buildSystemPrompt } from '../src/knowledge/prompt-builder.js';
import type { CallState, Lead, Stage } from '../src/types/domain.js';

const SLOT = { at: '2026-11-11T22:00:00.000Z', timezone: 'America/Los_Angeles', conflictChecked: true };

function state(stage: Stage, lead: Lead = {}, extra: Partial<CallState> = {}): CallState {
  return {
    callId: 'c',
    leadId: 'l',
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
    appointment: null,
    beats: NO_BEATS,
    ...extra,
  };
}

const short = { maxAirCycles: 2, callLength: 'short' as const };
const CONTACT: Lead = { name: 'Kevin', phone: '510-555-1212', homeowner_confirmed: true };

describe('short call — stage order', () => {
  it('goes from the opening straight to the two questions, without email or the letter', () => {
    expect(nextStage(state('opening', CONTACT), short).stage).toBe('qualification');
  });

  it('holds the opening until the home is confirmed as theirs', () => {
    expect(nextStage(state('opening', { name: 'Kevin', phone: '510-555-1212' }), short).stage).toBe(
      'opening',
    );
  });

  it('needs the bill and the address before the offer', () => {
    expect(nextStage(state('qualification', { ...CONTACT, monthly_bill: 280 }), short).stage).toBe(
      'qualification',
    );
    expect(
      nextStage(state('qualification', { ...CONTACT, monthly_bill: 280, address: '123 Maple St' }), short)
        .stage,
    ).toBe('value_pitch');
  });

  it('books without asking about decision makers', () => {
    const s = state('appointment', { ...CONTACT, monthly_bill: 280, address: '1 A St' }, { appointment: SLOT });
    expect(nextStage(s, short).stage).toBe('closing');
  });

  it('ends the call once the recap has been said', () => {
    const recap =
      "Michael will come by 123 Maple Street Wednesday at 2. He'll call before heading over — have your electric bill handy, make sure anyone else who helps decide is there, and there's nothing out of pocket. Thanks Kevin, take care!";
    expect(beatsInReply(recap).recap).toBe(true);
    const s = state('closing', CONTACT, { appointment: SLOT, beats: { ...NO_BEATS, recap: true } });
    expect(nextStage(s, short)).toMatchObject({ stage: 'ended', reason: 'recap_complete' });
  });

  it('catches up when the last answer and the offer land in the same turn', () => {
    // "123 Maple Street" answered the last question, and the agent went
    // straight into the offer: the call is now waiting on morning or afternoon.
    const s = state(
      'qualification',
      { ...CONTACT, monthly_bill: 280, address: '123 Maple St' },
      { beats: { ...NO_BEATS, pitch: true } },
    );
    expect(nextStage(s, short).stage).toBe('appointment');
  });

  it('ends in one step when the time is accepted and the wrap-up said together', () => {
    const s = state('appointment', { ...CONTACT, monthly_bill: 280, address: '1 A St' }, {
      appointment: SLOT,
      beats: { ...NO_BEATS, pitch: true, recap: true },
    });
    expect(nextStage(s, short)).toMatchObject({ stage: 'ended', reason: 'recap_complete' });
  });

  it('does not get stuck on the offer once a time has been accepted', () => {
    const s = state('value_pitch', { ...CONTACT, monthly_bill: 280, address: '1 A St' }, {
      appointment: SLOT,
    });
    expect(nextStage(s, short).stage).toBe('closing');
  });

  it('recognises the wrap-up as it was actually said on a live call', () => {
    const live =
      "Great, so Tuesday the 10th at 2 PM, Michael will come by 123 Maple Street. He'll give you a call before heading over. Just have your latest PG&E bill handy, and if there's anyone else who helps with decisions, have them there too. No cost, no obligation — he just confirms what you qualify for. Thanks Kevin, we'll see you Tuesday.";
    expect(beatsInReply(live).recap).toBe(true);
  });

  it('never skips a stage even when the model asks to', () => {
    expect(nextStage(state('opening', CONTACT), { ...short, proposedStage: 'appointment' }).stage).toBe(
      'qualification',
    );
  });

  it('leaves the full script unchanged', () => {
    expect(nextStage(state('opening', { ...CONTACT, email: 'k@x.com' }), { maxAirCycles: 2 }).stage).toBe(
      'rapport',
    );
  });
});

describe('short call — instructions', () => {
  const identity = {
    companyName: 'Helio',
    agentName: 'Sam',
    consultantName: 'Michael',
    serviceArea: undefined,
    callbackNumber: undefined,
  };
  const build = (s: CallState) =>
    buildSystemPrompt({ state: s, identity, objection: null, callLength: 'short' });

  it('asks name, phone and homeowner in the opening — never email', () => {
    const prompt = build(state('opening'));
    expect(prompt).toMatch(/SHORT call/);
    expect(prompt).toMatch(/1\. their name/);
    expect(prompt).toMatch(/whether they own the home/);
    expect(prompt).not.toMatch(/an email address to send the details to/);
  });

  it('asks only the bill and the address while qualifying', () => {
    const prompt = build(state('qualification', CONTACT));
    expect(prompt).toMatch(/1\. their average monthly electricity bill/);
    expect(prompt).toMatch(/2\. the street address for the visit/);
    expect(prompt).toMatch(/Ask NOTHING else/);
  });

  it('gives the offer the calendar, since it ends by asking morning or afternoon', () => {
    expect(build(state('value_pitch', { ...CONTACT, monthly_bill: 280 }))).toMatch(/RIGHT NOW/);
  });

  it('closes in one turn with no questions', () => {
    expect(build(state('closing', CONTACT, { appointment: SLOT }))).toMatch(/ask NO questions/);
  });
});
