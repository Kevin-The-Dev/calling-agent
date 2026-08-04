import { describe, expect, it } from 'vitest';
import {
  checkCompletenessGate,
  evaluateDisqualifiers,
  nextStage,
} from '../src/agents/state-machine.js';
import { scoreLead } from '../src/agents/scoring.js';
import type { CallState, Lead, Stage } from '../src/types/domain.js';

function makeState(overrides: Partial<CallState> = {}): CallState {
  return {
    callId: 'call-1',
    leadId: 'lead-1',
    stage: 'opening',
    returnStage: null,
    turnCount: 0,
    earlyObjectionCount: 0,
    lateObjectionCount: 0,
    consecutiveFallbacks: 0,
    lead: {},
    objections: [],
    qualificationScore: 0,
    qualificationBand: 'unqualified',
    buyingIntent: 'low',
    disqualifiedReason: null,
    doNotContact: false,
    outcome: null,
    ...overrides,
  };
}

const QUALIFIED_LEAD: Lead = {
  name: 'Sam',
  address: '1 Main St',
  homeowner_confirmed: true,
  home_type: 'single_family',
  owns_roof: true,
  monthly_bill: 240,
  utility_provider: 'PG&E',
  credit_score_band: 'above_650',
};

const opts = { maxAirCycles: 2 };

describe('stage progression', () => {
  it('advances one stage at a time', () => {
    const result = nextStage(makeState({ stage: 'opening' }), {
      ...opts,
      proposedStage: 'rapport',
    });
    expect(result.stage).toBe('rapport');
  });

  it('refuses to skip stages, advancing only one step instead', () => {
    // The model asking to jump straight from rapport to booking is exactly the
    // failure the state machine exists to prevent.
    const result = nextStage(makeState({ stage: 'rapport' }), {
      ...opts,
      proposedStage: 'appointment',
    });
    expect(result.stage).toBe('qualification');
    expect(result.rejectedProposal).toBe('appointment');
  });

  it('stays put when no transition is proposed', () => {
    expect(nextStage(makeState({ stage: 'qualification' }), opts).stage).toBe('qualification');
  });

  it('allows returning to qualification to fill a gap', () => {
    const result = nextStage(makeState({ stage: 'value_pitch', lead: QUALIFIED_LEAD }), {
      ...opts,
      proposedStage: 'qualification',
    });
    expect(result.stage).toBe('qualification');
  });

  it('refuses other backward moves', () => {
    const result = nextStage(makeState({ stage: 'appointment', lead: QUALIFIED_LEAD }), {
      ...opts,
      proposedStage: 'opening',
    });
    expect(result.stage).toBe('appointment');
    expect(result.rejectedProposal).toBe('opening');
  });
});

describe('completeness gate', () => {
  it('blocks qualification → need_discovery until every field is known', () => {
    const partial = { ...QUALIFIED_LEAD, monthly_bill: undefined };
    const result = nextStage(makeState({ stage: 'qualification', lead: partial }), {
      ...opts,
      proposedStage: 'need_discovery',
    });
    expect(result.stage).toBe('qualification');
  });

  it('opens once the lead is complete', () => {
    const result = nextStage(makeState({ stage: 'qualification', lead: QUALIFIED_LEAD }), {
      ...opts,
      proposedStage: 'need_discovery',
    });
    expect(result.stage).toBe('need_discovery');
  });

  it('accepts an unsure credit score as answered', () => {
    // The script explicitly reassures the prospect that the engineer verifies
    // credit later, so "unsure" must not stall the call.
    const gate = checkCompletenessGate({ ...QUALIFIED_LEAD, credit_score_band: 'unsure' });
    expect(gate.passed).toBe(true);
  });

  it('reports exactly which fields are missing', () => {
    const gate = checkCompletenessGate({ name: 'Sam' });
    expect(gate.passed).toBe(false);
    expect(gate.missing).toContain('address');
    expect(gate.missing).toContain('monthly_bill');
  });
});

describe('decision-maker gate', () => {
  it('blocks appointment → confirmation until decision makers are identified', () => {
    const result = nextStage(makeState({ stage: 'appointment', lead: QUALIFIED_LEAD }), {
      ...opts,
      proposedStage: 'confirmation',
    });
    expect(result.stage).toBe('appointment');
  });

  it('opens once they are known', () => {
    const lead = { ...QUALIFIED_LEAD, decision_makers: [{ name: 'Alex' }] };
    const result = nextStage(makeState({ stage: 'appointment', lead }), {
      ...opts,
      proposedStage: 'confirmation',
    });
    expect(result.stage).toBe('confirmation');
  });
});

describe('objection interrupt', () => {
  it('enters objection handling and remembers where it came from', () => {
    const result = nextStage(makeState({ stage: 'value_pitch', lead: QUALIFIED_LEAD }), {
      ...opts,
      hasObjection: true,
    });
    expect(result.stage).toBe('objection_handling');
    expect(result.returnStage).toBe('value_pitch');
  });

  it('returns to the originating stage afterwards', () => {
    const state = makeState({
      stage: 'objection_handling',
      returnStage: 'qualification',
      lead: QUALIFIED_LEAD,
    });
    expect(nextStage(state, opts).stage).toBe('qualification');
  });

  it('keeps the original return stage across consecutive objections', () => {
    const state = makeState({
      stage: 'objection_handling',
      returnStage: 'qualification',
      lead: QUALIFIED_LEAD,
    });
    const result = nextStage(state, { ...opts, hasObjection: true });
    expect(result.returnStage).toBe('qualification');
  });

  it('ends the call after the A.I.R. cycle limit', () => {
    const state = makeState({ stage: 'rapport', earlyObjectionCount: 2 });
    const result = nextStage(state, { ...opts, hasObjection: true });
    expect(result.stage).toBe('ended');
    expect(result.reason).toBe('air_cycles_exhausted');
  });
});

describe('disqualifiers', () => {
  it('flags a non-homeowner', () => {
    expect(evaluateDisqualifiers({ homeowner_confirmed: false })).toBe('not_homeowner');
  });

  it('flags a condo without roof ownership', () => {
    expect(evaluateDisqualifiers({ home_type: 'condo', owns_roof: false })).toBe(
      'no_roof_ownership',
    );
  });

  it('flags a bill under $60', () => {
    expect(evaluateDisqualifiers({ monthly_bill: 45 })).toBe('bill_under_60');
  });

  it('does not flag a bill between $60 and $150', () => {
    // The objection sheet keeps this band alive on a fixed-rate angle.
    expect(evaluateDisqualifiers({ monthly_bill: 95 })).toBeNull();
  });

  it('flags a move inside 6 months but not beyond it', () => {
    expect(evaluateDisqualifiers({ moving_timeline_months: 3 })).toBe('moving_under_6_months');
    expect(evaluateDisqualifiers({ moving_timeline_months: 12 })).toBeNull();
  });

  it('does not disqualify a landlord who owns the roof', () => {
    expect(
      evaluateDisqualifiers({
        homeowner_confirmed: true,
        owns_roof: true,
        home_type: 'single_family',
        has_tenant: true,
      }),
    ).toBeNull();
  });

  it('sends the call to disqualified from any stage', () => {
    const state = makeState({ stage: 'appointment', lead: { monthly_bill: 40 } });
    const result = nextStage(state, opts);
    expect(result.stage).toBe('disqualified');
    expect(result.reason).toBe('bill_under_60');
  });
});

describe('terminal conditions', () => {
  it('do-not-contact overrides everything, including an in-flight objection', () => {
    const state = makeState({ stage: 'value_pitch', lead: QUALIFIED_LEAD });
    const result = nextStage(state, { ...opts, hasObjection: true, doNotContact: true });
    expect(result.stage).toBe('ended');
    expect(result.reason).toBe('do_not_contact');
  });

  it('a finished call stays finished', () => {
    const result = nextStage(makeState({ stage: 'ended' }), { ...opts, proposedStage: 'opening' });
    expect(result.stage).toBe('ended');
  });
});

describe('scoring', () => {
  it('scores a strong lead as hot', () => {
    const result = scoreLead(
      { ...QUALIFIED_LEAD, shading: 'none', decision_makers: [{ name: 'Alex', will_attend: true }] },
      'high',
    );
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.band).toBe('hot');
  });

  it('forces a disqualified lead to zero regardless of other signals', () => {
    // A $300 bill and perfect credit must not rescue a renter.
    const result = scoreLead(
      { ...QUALIFIED_LEAD, monthly_bill: 300, homeowner_confirmed: false },
      'high',
    );
    expect(result.score).toBe(0);
    expect(result.band).toBe('unqualified');
    expect(result.disqualifiedReason).toBe('not_homeowner');
  });

  it('matches hand-computed weights', () => {
    // bill 240 → 24, homeowner → 20, single-family + roof → 15,
    // credit above 650 → 15, no decision makers → 0, shading unknown → 0,
    // intent medium → 3.  Total 77.
    const result = scoreLead(QUALIFIED_LEAD, 'medium');
    expect(result.breakdown['bill']).toBe(24);
    expect(result.breakdown['homeowner']).toBe(20);
    expect(result.breakdown['property']).toBe(15);
    expect(result.breakdown['credit']).toBe(15);
    expect(result.score).toBe(77);
  });

  it('never exceeds 100', () => {
    const result = scoreLead(
      {
        ...QUALIFIED_LEAD,
        monthly_bill: 900,
        shading: 'none',
        decision_makers: [{ name: 'A', will_attend: true }],
      },
      'high',
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('gives an unsure credit score partial credit rather than zero', () => {
    const unsure = scoreLead({ ...QUALIFIED_LEAD, credit_score_band: 'unsure' }, 'low');
    const above = scoreLead(QUALIFIED_LEAD, 'low');
    expect(unsure.score).toBeLessThan(above.score);
    expect(unsure.score).toBeGreaterThan(0);
  });
});

describe('full happy-path walk', () => {
  it('reaches closing without skipping a stage', () => {
    const path: Stage[] = [
      'rapport',
      'qualification',
      'need_discovery',
      'value_pitch',
      'appointment',
      'confirmation',
      'closing',
    ];

    let state = makeState({
      lead: { ...QUALIFIED_LEAD, decision_makers: [{ name: 'Alex', will_attend: true }] },
    });

    for (const target of path) {
      const result = nextStage(state, { ...opts, proposedStage: target });
      expect(result.stage).toBe(target);
      state = { ...state, stage: result.stage, returnStage: result.returnStage };
    }

    expect(state.stage).toBe('closing');
  });
});
