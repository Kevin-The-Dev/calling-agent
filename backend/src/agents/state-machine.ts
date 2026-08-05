/**
 * Conversation state machine.
 *
 * Server-authoritative by design (conversation-flow.md): the model *proposes* a
 * stage, this module decides. A language model asked to manage its own control
 * flow will happily jump from "hello" to booking an appointment; the guards
 * here are what make the sales process actually a process.
 */
import {
  LINEAR_STAGES,
  TERMINAL_STAGES,
  type CallState,
  type DqReason,
  type Lead,
  type Stage,
} from '../types/domain.js';

export interface TransitionResult {
  stage: Stage;
  returnStage: Stage | null;
  /** Set when the transition ends the call. */
  reason?: string;
  rejectedProposal?: Stage;
}

/** Fields that must be known before the agent may start booking (§9 gate). */
const COMPLETENESS_GATE: (keyof Lead)[] = [
  'name',
  'address',
  'homeowner_confirmed',
  'home_type',
  'owns_roof',
  'monthly_bill',
  'utility_provider',
  'credit_score_band',
];

export interface GateResult {
  passed: boolean;
  missing: (keyof Lead)[];
}

/**
 * Whether enough is known to move past qualification.
 * `credit_score_band: 'unsure'` counts as answered — the script explicitly
 * allows the engineer to verify it later.
 */
export function checkCompletenessGate(lead: Lead): GateResult {
  const missing = COMPLETENESS_GATE.filter((field) => {
    const value = lead[field];
    if (value === null || value === undefined || value === '') return true;
    if (field === 'home_type' && value === 'unknown') return true;
    return false;
  });
  return { passed: missing.length === 0, missing };
}

/** Hard disqualifiers from qualification-rules.md §1. */
export function evaluateDisqualifiers(lead: Lead): DqReason | null {
  if (lead.homeowner_confirmed === false) return 'not_homeowner';

  // Condo/townhome AND no roof ownership. Either alone is not a DQ — a
  // townhome owner who owns their roof still qualifies.
  const attachedHome = lead.home_type === 'condo' || lead.home_type === 'townhome';
  if (attachedHome && lead.owns_roof === false) return 'no_roof_ownership';
  if (lead.owns_roof === false && lead.home_type !== 'unknown' && lead.home_type != null) {
    return 'no_roof_ownership';
  }

  if (typeof lead.monthly_bill === 'number' && lead.monthly_bill < 60) return 'bill_under_60';

  if (typeof lead.moving_timeline_months === 'number' && lead.moving_timeline_months < 6) {
    return 'moving_under_6_months';
  }

  return null;
}

function indexOfLinear(stage: Stage): number {
  return LINEAR_STAGES.indexOf(stage);
}

/**
 * Decides the next stage.
 *
 * Order matters: terminal conditions win over everything, then objection
 * interrupts, then the guarded forward transition.
 */
export function nextStage(
  state: CallState,
  options: {
    proposedStage?: Stage | null;
    hasObjection?: boolean;
    doNotContact?: boolean;
    prospectEndedCall?: boolean;
    maxAirCycles: number;
  },
): TransitionResult {
  const { proposedStage, hasObjection, doNotContact, prospectEndedCall, maxAirCycles } = options;

  // Already finished.
  if (TERMINAL_STAGES.includes(state.stage)) {
    return { stage: state.stage, returnStage: null };
  }

  // 1. Unconditional stop. Nothing overrides this.
  if (doNotContact) {
    return { stage: 'ended', returnStage: null, reason: 'do_not_contact' };
  }

  if (prospectEndedCall) {
    return { stage: 'ended', returnStage: null, reason: 'prospect_ended' };
  }

  // 2. Disqualification, checked continuously — a DQ fact can surface at any
  // point, not only during qualification.
  const dq = evaluateDisqualifiers(state.lead);
  if (dq) {
    return { stage: 'disqualified', returnStage: null, reason: dq };
  }

  // 3. Objection interrupt.
  if (hasObjection) {
    // Two A.I.R. cycles with no engagement is the limit; pushing a third is
    // how a setter gets hung up on.
    if (state.stage === 'objection_handling' && state.earlyObjectionCount >= maxAirCycles) {
      return { stage: 'ended', returnStage: null, reason: 'air_cycles_exhausted' };
    }
    if (state.earlyObjectionCount >= maxAirCycles && isEarly(state)) {
      return { stage: 'ended', returnStage: null, reason: 'air_cycles_exhausted' };
    }

    return {
      stage: 'objection_handling',
      // Preserve the original return stage across consecutive objections.
      returnStage:
        state.stage === 'objection_handling' ? (state.returnStage ?? 'rapport') : state.stage,
    };
  }

  // 4. Coming out of objection handling.
  if (state.stage === 'objection_handling') {
    return { stage: state.returnStage ?? 'rapport', returnStage: null };
  }

  // 5. Guarded forward movement.
  const current = indexOfLinear(state.stage);
  if (current === -1) return { stage: state.stage, returnStage: null };

  // Server-side auto-advance.
  //
  // Relying on the model to propose every transition made the tracked stage lag
  // several turns behind the real conversation: the agent would be negotiating a
  // time slot while the state still said "qualification", so it kept receiving
  // qualification instructions and re-asking answered questions. When the
  // stage's own exit condition is objectively met, advance regardless of what
  // the model proposed.
  const auto = autoAdvance(state);
  const proposedRaw = proposedStage && proposedStage !== state.stage ? proposedStage : null;
  const proposed = proposedRaw ?? auto;

  if (!proposed) return { stage: state.stage, returnStage: null };

  const proposedIndex = indexOfLinear(proposed);

  // Only backward move allowed: returning to qualification to fill a gap.
  if (proposedIndex !== -1 && proposedIndex < current) {
    if (proposed === 'qualification') return { stage: 'qualification', returnStage: null };
    return { stage: state.stage, returnStage: null, rejectedProposal: proposed };
  }

  // Never skip. A model proposing "appointment" from "rapport" advances one
  // step to "qualification" instead of being obeyed.
  if (proposedIndex !== current + 1) {
    const nextAllowed = LINEAR_STAGES[current + 1];
    return {
      stage: nextAllowed ?? state.stage,
      returnStage: null,
      rejectedProposal: proposed,
    };
  }

  // Gate: qualification → need_discovery requires the completeness gate.
  if (state.stage === 'qualification' && !checkCompletenessGate(state.lead).passed) {
    return { stage: 'qualification', returnStage: null, rejectedProposal: proposed };
  }

  // Gate: appointment → confirmation requires identified decision makers.
  if (state.stage === 'appointment' && (state.lead.decision_makers ?? []).length === 0) {
    return { stage: 'appointment', returnStage: null, rejectedProposal: proposed };
  }

  return { stage: proposed, returnStage: null };
}

/**
 * The next stage when the current stage's objective is already satisfied.
 * Returns null when the agent still has work to do where it is.
 */
function autoAdvance(state: CallState): Stage | null {
  const { lead, stage } = state;

  switch (stage) {
    case 'opening':
      // The one thing the opening must establish.
      return lead.homeowner_confirmed === true ? 'rapport' : null;

    case 'rapport':
      // Rapport is a delivery beat, not a data-gathering one. Once the agent
      // has spoken it and the prospect has engaged at all, move on.
      return state.turnCount >= 2 ? 'qualification' : null;

    case 'qualification':
      return checkCompletenessGate(lead).passed ? 'need_discovery' : null;

    case 'need_discovery':
      return (lead.pain_points ?? []).length > 0 || state.turnCount >= 6 ? 'value_pitch' : null;

    case 'value_pitch':
      // One turn is enough: the pitch is delivered in a single reply.
      return 'appointment';

    case 'appointment':
      return (lead.decision_makers ?? []).length > 0 ? 'confirmation' : null;

    case 'confirmation':
      // The recap reads back a number the confirmation text will go to, so the
      // number has to exist first. Relying on the model to propose `closing`
      // meant it sometimes recapped before it had ever asked for one.
      return lead.phone ? 'closing' : null;

    default:
      return null;
  }
}

function isEarly(state: CallState): boolean {
  const effective =
    state.stage === 'objection_handling' ? (state.returnStage ?? 'opening') : state.stage;
  return effective === 'opening' || effective === 'rapport';
}

/** Maps a terminal stage plus context to the recorded call outcome. */
export function resolveOutcome(state: CallState, reason?: string): CallState['outcome'] {
  if (state.stage === 'disqualified') return 'disqualified';
  if (reason === 'do_not_contact' || reason === 'air_cycles_exhausted') return 'not_interested';

  // A call that got as far as confirmation or closing produced a real result,
  // even if the prospect hung up before the final goodbye. Recording those as
  // 'abandoned' buried qualified leads that had already agreed to a time —
  // caught in end-to-end testing.
  if (['confirmation', 'closing', 'ended'].includes(state.stage)) {
    // 'partial' not 'booked': the booking service upgrades it only once an
    // appointment row actually satisfies its constraints. The agent saying
    // "you're all set" is not evidence that anything was written.
    if ((state.lead.decision_makers ?? []).length > 0 || state.qualificationScore >= 50) {
      return 'partial';
    }
    return 'callback';
  }

  if (reason === 'prospect_ended') return 'abandoned';
  return null;
}

/**
 * Final outcome for a call being closed out.
 * Used by the end endpoint, where the in-flight `reason` is no longer available
 * because state was reloaded from the database.
 */
export function resolveFinalOutcome(state: CallState): NonNullable<CallState['outcome']> {
  if (state.outcome) return state.outcome;
  if (state.doNotContact) return 'not_interested';
  if (state.disqualifiedReason) return 'disqualified';
  return resolveOutcome(state) ?? 'abandoned';
}
