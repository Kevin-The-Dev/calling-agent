/**
 * Call and lead persistence.
 *
 * All writes go through the service-role client (database.md §5) — the browser
 * has no insert policy on any of these tables, by design.
 */
import type { Env } from '../lib/env.js';
import { databaseError } from '../lib/errors.js';
import type { Database, Json } from '../types/database.js';
import type { CallState, Lead, Stage, TranscriptTurn } from '../types/domain.js';
import { getServiceClient } from './supabase.js';

type LeadUpdate = Database['public']['Tables']['leads']['Update'];

export interface StartCallResult {
  callId: string;
  leadId: string;
}

/** Creates the lead + call pair that a conversation runs against. */
export async function startCall(env: Env, consentGiven: boolean): Promise<StartCallResult> {
  const db = getServiceClient(env);

  const { data: lead, error: leadError } = await db
    .from('leads')
    .insert({ status: 'new', timezone: env.DEFAULT_TIMEZONE })
    .select('id')
    .single();

  if (leadError || !lead) {
    throw databaseError('Could not create the lead record', { message: leadError?.message });
  }

  const { data: call, error: callError } = await db
    .from('calls')
    .insert({
      lead_id: lead.id,
      status: 'active',
      stage: 'opening',
      consent_given: consentGiven,
      consent_at: consentGiven ? new Date().toISOString() : null,
      stt_provider: env.STT_PROVIDER,
      tts_provider: env.TTS_PROVIDER,
      llm_model: env.LLM_PROVIDER === 'glm' ? env.GLM_MODEL : (env.KIMI_MODEL ?? 'unknown'),
    })
    .select('id')
    .single();

  if (callError || !call) {
    throw databaseError('Could not create the call record', { message: callError?.message });
  }

  return { callId: call.id as string, leadId: lead.id as string };
}

/**
 * Rebuilds in-memory call state from the database.
 *
 * The lead is embedded rather than fetched second. Two sequential round trips
 * cost ~340ms against this project; the join costs ~170ms and returns the same
 * data, and it sits directly on the path between the prospect finishing a
 * sentence and the model being asked to answer.
 */
export async function loadCallState(env: Env, callId: string): Promise<CallState | null> {
  const db = getServiceClient(env);

  // Kept as one literal string: supabase-js infers the row type from the
  // select string, and concatenation collapses it to an error type.
  const { data: call, error } = await db
    .from('calls')
    .select('id, lead_id, stage, return_stage, turn_count, early_objection_count, late_objection_count, qualification_score, buying_intent, outcome, status, leads(*)')
    .eq('id', callId)
    .maybeSingle();

  if (error) throw databaseError('Could not read the call', { message: error.message });
  if (!call) return null;

  // A `lead_id` foreign key embeds as an object, but PostgREST returns an array
  // when it cannot prove the relationship is to-one. Accept both.
  const embedded = (call as Record<string, unknown>)['leads'];
  const lead = (Array.isArray(embedded) ? embedded[0] : embedded) as Record<string, unknown> | null;

  return {
    callId: call.id as string,
    leadId: call.lead_id as string,
    stage: call.stage as Stage,
    returnStage: (call.return_stage as Stage | null) ?? null,
    turnCount: (call.turn_count as number) ?? 0,
    earlyObjectionCount: (call.early_objection_count as number) ?? 0,
    lateObjectionCount: (call.late_objection_count as number) ?? 0,
    consecutiveFallbacks: 0,
    lead: toLead(lead),
    objections: [],
    qualificationScore: (call.qualification_score as number) ?? 0,
    qualificationBand: 'unqualified',
    buyingIntent: (call.buying_intent as CallState['buyingIntent']) ?? 'low',
    disqualifiedReason: null,
    doNotContact: Boolean((lead as Record<string, unknown> | null)?.['do_not_contact']),
    outcome: (call.outcome as CallState['outcome']) ?? null,
  };
}

/** Recent turns for a call, oldest first, capped to the prompt's window. */
export async function loadHistory(env: Env, callId: string): Promise<TranscriptTurn[]> {
  const { data } = await getServiceClient(env)
    .from('transcript_turns')
    .select('speaker, content, stage')
    .eq('call_id', callId)
    .order('turn_index', { ascending: true })
    .limit(40);

  return (data ?? []).map((row) => ({
    speaker: row.speaker as TranscriptTurn['speaker'],
    content: row.content as string,
    stage: row.stage as TranscriptTurn['stage'],
  }));
}

/**
 * Everything a turn needs, in one wall-clock round trip.
 *
 * The history query does not depend on the state query, so running them in
 * sequence only ever cost time. Prefer the cache — see call-cache.ts — and fall
 * back to this on a cold instance.
 */
export async function loadCallContext(
  env: Env,
  callId: string,
): Promise<{ state: CallState; history: TranscriptTurn[] } | null> {
  const [state, history] = await Promise.all([
    loadCallState(env, callId),
    loadHistory(env, callId),
  ]);

  if (!state) return null;
  return { state, history };
}

/**
 * The state a call begins in.
 *
 * Built here rather than read back after the insert so the first turn — the
 * agent's opening line, the one the prospect waits on with nothing else
 * happening — needs no database read at all.
 */
export function initialCallState(callId: string, leadId: string, timezone: string): CallState {
  return {
    callId,
    leadId,
    stage: 'opening',
    returnStage: null,
    turnCount: 0,
    earlyObjectionCount: 0,
    lateObjectionCount: 0,
    consecutiveFallbacks: 0,
    lead: { timezone },
    objections: [],
    qualificationScore: 0,
    qualificationBand: 'unqualified',
    buyingIntent: 'low',
    disqualifiedReason: null,
    doNotContact: false,
    outcome: null,
  };
}

function toLead(row: Record<string, unknown> | null): Lead {
  if (!row) return {};
  return {
    name: row['name'] as string | null,
    phone: row['phone'] as string | null,
    email: row['email'] as string | null,
    address: row['address'] as string | null,
    timezone: row['timezone'] as string | null,
    homeowner_confirmed: row['homeowner_confirmed'] as boolean | null,
    home_type: row['home_type'] as Lead['home_type'],
    owns_roof: row['owns_roof'] as boolean | null,
    monthly_bill: row['monthly_bill'] === null ? null : Number(row['monthly_bill']),
    utility_provider: row['utility_provider'] as string | null,
    roof_type: row['roof_type'] as string | null,
    shading: row['shading'] as Lead['shading'],
    credit_score_band: row['credit_score_band'] as Lead['credit_score_band'],
    already_has_solar: row['already_has_solar'] as boolean | null,
    moving_timeline_months: row['moving_timeline_months'] as number | null,
    has_tenant: row['has_tenant'] as boolean | null,
    decision_makers: (row['decision_makers'] as Lead['decision_makers']) ?? [],
    pain_points: (row['pain_points'] as string[] | null) ?? [],
    buying_intent: row['buying_intent'] as Lead['buying_intent'],
    summary: row['summary'] as string | null,
  };
}

export interface PersistTurnInput {
  state: CallState;
  prospectUtterance: string;
  agentReply: string;
  previousStage: Stage;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  objectionId: string | null;
  objectionQuote: string | null;
  /**
   * Where the prospect's utterance sits in the recording, in milliseconds from
   * the moment capture began. Optional — a turn without them is still valid,
   * it simply cannot be highlighted while the recording plays.
   */
  audioStartMs?: number | null;
  audioEndMs?: number | null;
}

/** Writes both transcript turns, the updated lead, and the call row. */
export async function persistTurn(env: Env, input: PersistTurnInput): Promise<void> {
  const db = getServiceClient(env);
  const { state, previousStage } = input;

  const baseIndex = (state.turnCount - 1) * 2;

  // The agent is inaudible in the recording — browser synthesis never reaches
  // the microphone stream — so its row gets a start but no end. It begins the
  // moment the prospect stops, and the dashboard runs it up to whenever the
  // next prospect turn starts. See implementation.md R13.
  const agentStartMs = input.audioEndMs ?? null;

  const { error: turnError } = await db.from('transcript_turns').insert([
    {
      call_id: state.callId,
      turn_index: baseIndex,
      speaker: 'prospect',
      content: input.prospectUtterance,
      stage: previousStage,
      audio_start_ms: input.audioStartMs ?? null,
      audio_end_ms: input.audioEndMs ?? null,
    },
    {
      call_id: state.callId,
      turn_index: baseIndex + 1,
      speaker: 'agent',
      content: input.agentReply,
      stage: state.stage,
      latency_ms: input.latencyMs,
      llm_tokens_in: input.tokensIn,
      llm_tokens_out: input.tokensOut,
      audio_start_ms: agentStartMs,
    },
  ]);

  if (turnError) {
    throw databaseError('Could not write the transcript', { message: turnError.message });
  }

  // Built key by key rather than spread: an `undefined` in an update payload
  // blanks the column, so a field the agent hasn't learned yet would erase one
  // it learned three turns ago.
  const leadUpdate: Record<string, unknown> = {
    buying_intent: state.buyingIntent,
    qualification_score: state.qualificationScore,
    qualification_band: state.qualificationBand,
    status: leadStatusFor(state),
    decision_makers: state.lead.decision_makers ?? [],
    pain_points: state.lead.pain_points ?? [],
  };

  for (const [key, value] of Object.entries(state.lead)) {
    if (value === undefined || value === null) continue;
    if (key === 'decision_makers' || key === 'pain_points' || key === 'buying_intent') continue;
    leadUpdate[key] = value;
  }

  if (state.disqualifiedReason) leadUpdate['disqualified_reason'] = state.disqualifiedReason;

  // do_not_contact is write-once: the database trigger rejects clearing it, so
  // only ever set it to true, never write false over an existing true.
  if (state.doNotContact) leadUpdate['do_not_contact'] = true;

  const { error: leadError } = await db
    .from('leads').update(leadUpdate as LeadUpdate)
    .eq('id', state.leadId);
  if (leadError) {
    throw databaseError('Could not update the lead', { message: leadError.message });
  }

  const { error: callError } = await db
    .from('calls')
    .update({
      stage: state.stage,
      return_stage: state.returnStage,
      turn_count: state.turnCount,
      early_objection_count: state.earlyObjectionCount,
      late_objection_count: state.lateObjectionCount,
      qualification_score: state.qualificationScore,
      buying_intent: state.buyingIntent,
    })
    .eq('id', state.callId);

  if (callError) {
    throw databaseError('Could not update the call', { message: callError.message });
  }

  if (input.objectionId && input.objectionQuote) {
    await db.from('objection_events').insert({
      call_id: state.callId,
      lead_id: state.leadId,
      objection_id: input.objectionId,
      objection_class: input.objectionId.startsWith('early.') ? 'early' : 'late',
      quote: input.objectionQuote,
      stage_at: previousStage,
      resolved: true,
    });
  }
}

function leadStatusFor(state: CallState): LeadUpdate['status'] {
  if (state.doNotContact) return 'do_not_contact';
  if (state.disqualifiedReason) return 'disqualified';
  if (state.outcome === 'booked') return 'booked';
  if (state.qualificationScore >= 50) return 'qualified';
  if (state.turnCount > 1) return 'qualifying';
  return 'new';
}

/** Records a discrete event for analytics and the audit trail. */
export async function recordEvent(
  env: Env,
  callId: string,
  type: string,
  payload: Json = {},
): Promise<void> {
  await getServiceClient(env).from('call_events').insert({ call_id: callId, type, payload });
}

/** Closes out a call: outcome, summary, and status. */
export async function endCall(
  env: Env,
  state: CallState,
  summary: string | null,
): Promise<void> {
  const db = getServiceClient(env);

  await db
    .from('calls')
    .update({
      status: 'completed',
      ended_at: new Date().toISOString(),
      outcome: state.outcome ?? 'abandoned',
      summary,
      stage: state.stage,
      qualification_score: state.qualificationScore,
      buying_intent: state.buyingIntent,
    })
    .eq('id', state.callId);

  if (summary) {
    await db.from('leads').update({ summary }).eq('id', state.leadId);
  }
}
