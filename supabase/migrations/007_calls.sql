-- 007 — Calls
-- One row per conversation. `stage` is the server-authoritative position in the
-- state machine; `return_stage` is where objection handling came from.

create table if not exists calls (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references leads(id) on delete cascade,
  campaign_id           uuid references campaigns(id) on delete set null,

  status                call_status not null default 'active',
  outcome               call_outcome,
  stage                 conversation_stage not null default 'opening',
  return_stage          conversation_stage,

  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  duration_seconds      int generated always as
                          (extract(epoch from (ended_at - started_at))::int) stored,

  turn_count            int not null default 0,
  early_objection_count int not null default 0,
  late_objection_count  int not null default 0,

  summary               text,
  buying_intent         buying_intent not null default 'low',
  qualification_score   int not null default 0,

  -- Consent gate: recording must not start before this is true (R1).
  consent_given         boolean not null default false,
  consent_at            timestamptz,

  -- Which configuration produced this conversation.
  agent_settings_id     uuid references agent_settings(id),
  stt_provider          text,
  tts_provider          text,
  llm_model             text,
  error                 text,

  created_at            timestamptz not null default now()
);

create index if not exists calls_lead_idx    on calls(lead_id);
-- Partial index: the dashboard's live-calls view only ever queries active rows.
create index if not exists calls_status_idx  on calls(status) where status = 'active';
create index if not exists calls_started_idx on calls(started_at desc);
create index if not exists calls_outcome_idx on calls(outcome);
