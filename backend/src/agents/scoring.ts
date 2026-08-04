/**
 * Qualification scoring.
 *
 * Implements the weights in qualification-rules.md §7. Computed here, on the
 * server, from the lead object — never taken from the model. A model that could
 * assert its own score would learn to assert a high one.
 */
import type {
  BuyingIntent,
  DqReason,
  Lead,
  QualificationBand,
} from '../types/domain.js';
import { evaluateDisqualifiers } from './state-machine.js';

export interface ScoreResult {
  score: number;
  band: QualificationBand;
  disqualifiedReason: DqReason | null;
  breakdown: Record<string, number>;
}

/** Monthly bill — 30 points. The single strongest signal. */
function scoreBill(bill: number | null | undefined): number {
  if (typeof bill !== 'number') return 0;
  if (bill < 60) return 0; // disqualifying, handled separately
  if (bill > 250) return 30;
  if (bill >= 150) return 24;
  if (bill >= 100) return 15;
  return 8;
}

/** Roof ownership and home type — 15 points. */
function scoreProperty(lead: Lead): number {
  const singleFamily = lead.home_type === 'single_family';
  if (singleFamily && lead.owns_roof === true) return 15;
  if (lead.owns_roof === true) return 10;
  return 0;
}

/** Credit — 15 points. Unsure is explicitly not fatal. */
function scoreCredit(lead: Lead): number {
  switch (lead.credit_score_band) {
    case 'above_650':
      return 15;
    case 'unsure':
    case 'declined':
      return 8;
    case 'below_650':
      // The recovery ladder (co-signer, another person on the home) keeps this
      // alive, so it is worth points rather than zero.
      return 5;
    default:
      return 0;
  }
}

/** Decision makers — 10 points. */
function scoreDecisionMakers(lead: Lead): number {
  const makers = lead.decision_makers ?? [];
  if (makers.length === 0) return 0;
  return makers.every((m) => m.will_attend === true) ? 10 : 5;
}

function scoreShading(lead: Lead): number {
  switch (lead.shading) {
    case 'none':
      return 5;
    case 'partial':
      return 3;
    default:
      return 0;
  }
}

function scoreIntent(intent: BuyingIntent | null | undefined): number {
  if (intent === 'high') return 5;
  if (intent === 'medium') return 3;
  return 0;
}

function bandFor(score: number): QualificationBand {
  if (score >= 75) return 'hot';
  if (score >= 50) return 'warm';
  if (score >= 25) return 'cold';
  return 'unqualified';
}

/**
 * Scores a lead 0–100.
 * Any hard disqualifier forces the score to 0 regardless of other signals.
 */
export function scoreLead(lead: Lead, buyingIntent?: BuyingIntent | null): ScoreResult {
  const disqualifiedReason = evaluateDisqualifiers(lead);

  if (disqualifiedReason) {
    return {
      score: 0,
      band: 'unqualified',
      disqualifiedReason,
      breakdown: { disqualified: 0 },
    };
  }

  const breakdown: Record<string, number> = {
    bill: scoreBill(lead.monthly_bill),
    homeowner: lead.homeowner_confirmed === true ? 20 : 0,
    property: scoreProperty(lead),
    credit: scoreCredit(lead),
    decisionMakers: scoreDecisionMakers(lead),
    shading: scoreShading(lead),
    intent: scoreIntent(buyingIntent ?? lead.buying_intent),
  };

  const score = Math.min(
    100,
    Object.values(breakdown).reduce((sum, n) => sum + n, 0),
  );

  return { score, band: bandFor(score), disqualifiedReason: null, breakdown };
}
