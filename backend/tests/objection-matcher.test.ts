import { describe, expect, it } from 'vitest';
import {
  detectDoNotContact,
  detectHostility,
  matchObjection,
  objectionClassForStage,
} from '../src/knowledge/objection-matcher.js';
import { OBJECTION_CATALOGUE } from '../src/knowledge/objection-catalogue.js';

describe('catalogue coverage', () => {
  it('has all 24 objections from the sheet — 6 early, 18 late', () => {
    const early = OBJECTION_CATALOGUE.filter((o) => o.objectionClass === 'early');
    const late = OBJECTION_CATALOGUE.filter((o) => o.objectionClass === 'late');
    expect(early).toHaveLength(6);
    expect(late).toHaveLength(18);
  });

  it('has unique ids and non-empty guidance for every entry', () => {
    const ids = OBJECTION_CATALOGUE.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of OBJECTION_CATALOGUE) {
      expect(entry.guidance.length).toBeGreaterThan(40);
      expect(entry.phrases.length).toBeGreaterThan(0);
    }
  });
});

describe('objectionClassForStage', () => {
  it('treats opening and rapport as early', () => {
    expect(objectionClassForStage('opening', null)).toBe('early');
    expect(objectionClassForStage('rapport', null)).toBe('early');
  });

  it('treats everything after qualification as late', () => {
    expect(objectionClassForStage('qualification', null)).toBe('late');
    expect(objectionClassForStage('value_pitch', null)).toBe('late');
    expect(objectionClassForStage('appointment', null)).toBe('late');
  });

  it('uses the return stage while handling an objection', () => {
    expect(objectionClassForStage('objection_handling', 'opening')).toBe('early');
    expect(objectionClassForStage('objection_handling', 'value_pitch')).toBe('late');
  });
});

describe('matchObjection — early stage', () => {
  const cases: [string, string][] = [
    ["I'm not interested, thanks", 'early.not_interested'],
    ['Look, I am really busy right now', 'early.busy'],
    ['Can you just send me an email?', 'early.send_email'],
    ['Call me back later', 'early.call_back'],
    ['How did you get my number?', 'early.how_got_number'],
    ['You are the 5th person to call me today', 'early.too_many_calls'],
  ];

  for (const [utterance, expectedId] of cases) {
    it(`matches "${utterance}" → ${expectedId}`, () => {
      const match = matchObjection(utterance, 'opening');
      expect(match?.entry.id).toBe(expectedId);
    });
  }
});

describe('matchObjection — late stage', () => {
  const cases: [string, string][] = [
    ["I don't want holes in my roof", 'late.1_roof_holes'],
    ['My roof is too old, I need a new roof soon', 'late.2_old_roof'],
    ['I have a flat roof', 'late.3_special_roof'],
    ['I am worried it will leak', 'late.4_leaks'],
    ['I do not like how they look on the house', 'late.5_appearance'],
    ['I do not see the return on investment', 'late.6_roi'],
    ['I really do not want another bill', 'late.7_another_bill'],
    ['My bill is low already', 'late.8_low_bill'],
    ["What's the catch?", 'late.9_catch'],
    ["I don't want to finance anything", 'late.10_no_finance'],
    ['I want to wait until prices drop', 'late.11_wait_prices'],
    ['My credit is bad', 'late.12_bad_credit'],
    ['I rent, I am not the homeowner', 'late.13_renter'],
    ['I have a tenant living there', 'late.14_has_tenant'],
    ['We are planning to move next year', 'late.15_moving'],
    ['We are doing a remodel soon', 'late.16_renovations'],
    ['My cousin had a bad experience with solar', 'late.17_bad_experience'],
    ['Just send me an email with the details', 'late.18_send_email'],
  ];

  for (const [utterance, expectedId] of cases) {
    it(`matches "${utterance}" → ${expectedId}`, () => {
      const match = matchObjection(utterance, 'value_pitch');
      expect(match?.entry.id).toBe(expectedId);
    });
  }
});

describe('matchObjection — discrimination', () => {
  it('returns null for ordinary conversation', () => {
    expect(matchObjection('Yes, this is Sam speaking', 'opening')).toBeNull();
    expect(matchObjection('About two hundred and forty dollars', 'qualification')).toBeNull();
    expect(matchObjection('Sure, that works for me', 'appointment')).toBeNull();
  });

  it('returns null for empty or whitespace input', () => {
    expect(matchObjection('', 'opening')).toBeNull();
    expect(matchObjection('   ', 'opening')).toBeNull();
  });

  it('prefers the early variant of "send me an email" during the opening', () => {
    expect(matchObjection('send me an email', 'opening')?.entry.id).toBe('early.send_email');
  });

  it('still catches a disqualifying objection raised at the wrong stage', () => {
    // "I rent" during the opening is a real disqualification, not a smokescreen.
    const match = matchObjection('I rent, I am not the homeowner', 'opening');
    expect(match?.entry.id).toBe('late.13_renter');
    expect(match?.entry.dqHint).toBe('not_homeowner');
  });

  it('distinguishes being a tenant from having a tenant', () => {
    expect(matchObjection('I rent, this is not my house', 'qualification')?.entry.dqHint).toBe(
      'not_homeowner',
    );
    expect(matchObjection('I have a tenant living there', 'qualification')?.entry.id).toBe(
      'late.14_has_tenant',
    );
  });
});

describe('detectDoNotContact', () => {
  const stops = [
    'take me off your list',
    'do not call me again',
    "don't call me anymore",
    'stop calling me',
    'put me on the do not call list',
    'lose my number',
    'remove me from your list',
  ];

  for (const utterance of stops) {
    it(`flags "${utterance}"`, () => {
      expect(detectDoNotContact(utterance)).toBe(true);
    });
  }

  it('does not fire on ordinary refusal', () => {
    // "Not interested" is an A.I.R. objection, not a removal request. Treating
    // it as one would end callable conversations permanently.
    expect(detectDoNotContact("I'm not interested")).toBe(false);
    expect(detectDoNotContact('call me back tomorrow')).toBe(false);
  });
});

describe('detectHostility', () => {
  it('flags abuse', () => {
    expect(detectHostility('what the fuck do you want')).toBe(true);
  });

  it('does not flag frustration', () => {
    expect(detectHostility('this is really annoying')).toBe(false);
  });
});
