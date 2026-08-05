/**
 * Core domain types.
 *
 * These mirror the database schema in database.md and the state machine in
 * docs/knowledge/conversation-flow.md. Zod schemas live alongside the types so
 * anything crossing a boundary — model output, HTTP body, database row — is
 * validated rather than trusted.
 */
import { z } from 'zod';

// ─── Conversation stages ─────────────────────────────────────────────────────

export const STAGES = [
  'opening',
  'rapport',
  'qualification',
  'need_discovery',
  'value_pitch',
  'objection_handling',
  'appointment',
  'confirmation',
  'closing',
  'disqualified',
  'ended',
] as const;

export const stageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof stageSchema>;

/** Stages the agent advances through in order. Excludes the interrupt and terminals. */
export const LINEAR_STAGES: Stage[] = [
  'opening',
  'rapport',
  'qualification',
  'need_discovery',
  'value_pitch',
  'appointment',
  'confirmation',
  'closing',
];

export const TERMINAL_STAGES: Stage[] = ['disqualified', 'ended'];

/** Early objections use A.I.R.; later ones use the 6-step framework. */
export const EARLY_STAGES: Stage[] = ['opening', 'rapport'];

// ─── Outcomes and enums ──────────────────────────────────────────────────────

export const outcomeSchema = z.enum([
  'booked',
  'partial',
  'callback',
  'disqualified',
  'not_interested',
  'abandoned',
]);
export type Outcome = z.infer<typeof outcomeSchema>;

export const dqReasonSchema = z.enum([
  'not_homeowner',
  'no_roof_ownership',
  'bill_under_60',
  'moving_under_6_months',
  'minor',
  'do_not_contact',
  'wrong_number',
  'other',
]);
export type DqReason = z.infer<typeof dqReasonSchema>;

export const homeTypeSchema = z.enum([
  'single_family',
  'condo',
  'townhome',
  'mobile',
  'other',
  'unknown',
]);
export const creditBandSchema = z.enum(['above_650', 'below_650', 'unsure', 'declined']);
export const shadingSchema = z.enum(['none', 'partial', 'major', 'unknown']);
export const buyingIntentSchema = z.enum(['low', 'medium', 'high']);
export const qualificationBandSchema = z.enum(['hot', 'warm', 'cold', 'unqualified']);

export type BuyingIntent = z.infer<typeof buyingIntentSchema>;
export type QualificationBand = z.infer<typeof qualificationBandSchema>;

// ─── Lead ────────────────────────────────────────────────────────────────────

export const decisionMakerSchema = z.object({
  name: z.string(),
  relationship: z.string().optional(),
  will_attend: z.boolean().optional(),
});
export type DecisionMaker = z.infer<typeof decisionMakerSchema>;

/**
 * The live lead object (claude.md §7), updated after every prospect response.
 * Everything is optional: the agent learns fields incrementally across a call
 * and must never assume a value it hasn't been told.
 */
export const leadSchema = z.object({
  name: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  address: z.string().nullish(),
  timezone: z.string().nullish(),

  homeowner_confirmed: z.boolean().nullish(),
  home_type: homeTypeSchema.nullish(),
  owns_roof: z.boolean().nullish(),
  monthly_bill: z.number().nullish(),
  bill_over_150: z.boolean().nullish(),
  utility_provider: z.string().nullish(),
  roof_type: z.string().nullish(),
  roof_condition: z.string().nullish(),
  shading: shadingSchema.nullish(),
  credit_score_band: creditBandSchema.nullish(),
  taxable_income_over_45k: z.boolean().nullish(),
  already_has_solar: z.boolean().nullish(),
  moving_timeline_months: z.number().nullish(),
  has_tenant: z.boolean().nullish(),

  decision_makers: z.array(decisionMakerSchema).nullish(),
  pain_points: z.array(z.string()).nullish(),

  buying_intent: buyingIntentSchema.nullish(),
  language: z.string().nullish(),
  summary: z.string().nullish(),
  notes: z.string().nullish(),
});

export type Lead = z.infer<typeof leadSchema>;

/** A partial update produced by one turn's extraction. */
export type LeadPatch = Partial<Lead>;

// ─── Objections ──────────────────────────────────────────────────────────────

export const objectionClassSchema = z.enum(['early', 'late']);
export type ObjectionClass = z.infer<typeof objectionClassSchema>;

export interface ObjectionRecord {
  id: string;
  objectionClass: ObjectionClass;
  quote: string;
  stageAt: Stage;
  resolved: boolean;
}

// ─── Call state ──────────────────────────────────────────────────────────────

/**
 * The slot the prospect has agreed to.
 *
 * Held on the call from the moment it is agreed so the closing recap reads back
 * the same time that was booked. Before this existed the recap re-invented a
 * time several turns later, and the two did not match.
 */
export interface AgreedAppointment {
  /** ISO 8601 instant. */
  at: string;
  timezone: string;
  /** Set once the "anything that would keep you from being available" check passed. */
  conflictChecked: boolean;
}

export interface CallState {
  callId: string;
  leadId: string;
  stage: Stage;
  /** Where objection handling must return to. */
  returnStage: Stage | null;
  turnCount: number;
  earlyObjectionCount: number;
  lateObjectionCount: number;
  consecutiveFallbacks: number;
  lead: Lead;
  objections: ObjectionRecord[];
  qualificationScore: number;
  qualificationBand: QualificationBand;
  buyingIntent: BuyingIntent;
  disqualifiedReason: DqReason | null;
  doNotContact: boolean;
  outcome: Outcome | null;
  appointment: AgreedAppointment | null;
  /**
   * The required *statements* the agent has actually made — SGIP and the bill
   * swap. See agents/beats.ts for why a spoken beat needs tracking of its own.
   */
  beats: DeliveredBeats;
}

/** Which of the script's content beats have been delivered. */
export interface DeliveredBeats {
  sgip: boolean;
  pitch: boolean;
}

export interface TranscriptTurn {
  speaker: 'agent' | 'prospect' | 'system';
  content: string;
  stage: Stage;
}

// ─── Extraction result (what the extractor model returns) ────────────────────

/**
 * The extractor's output contract.
 *
 * Deliberately does NOT include `qualification_score` — that is computed
 * server-side from the lead object. A model must never be able to inflate a
 * lead's score by asserting one.
 */
export const extractionSchema = z.object({
  lead_patch: leadSchema.partial(),
  proposed_stage: stageSchema.nullish(),
  objection: z
    .object({
      id: z.string(),
      quote: z.string(),
      resolved: z.boolean(),
    })
    .nullish(),
  buying_intent: buyingIntentSchema.nullish(),
  disqualified_reason: dqReasonSchema.nullish(),
  requests_do_not_contact: z.boolean().nullish(),
  wants_callback: z.boolean().nullish(),
  prospect_ended_call: z.boolean().nullish(),

  /**
   * The slot, only once the prospect has actually agreed to it.
   *
   * A local date and a local time rather than an instant: a model asked for a
   * full ISO instant produces a confident, wrong offset, because it does not
   * know whether the prospect's zone is on daylight time that week. Kept as two
   * flat fields because a nested optional object goes missing too often.
   */
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  appointment_time: z.string().regex(/^\d{1,2}:\d{2}$/).nullish(),
  /** True once they have confirmed nothing would keep them from that time. */
  appointment_conflict_checked: z.boolean().nullish(),
});

export type Extraction = z.infer<typeof extractionSchema>;
