-- ============================================================
-- GENERATED FILE — do not edit.
-- Source: supabase/migrations/*.sql
-- Rebuild: node scripts/build-migration-bundle.mjs
--
-- Paste into the Supabase SQL Editor and run. Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 001_extensions.sql
-- ------------------------------------------------------------

-- 001 — Extensions
-- pgcrypto : gen_random_uuid() for primary keys
-- pg_trgm  : fuzzy search over lead name / phone / address in the dashboard

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ------------------------------------------------------------
-- 002_enums.sql
-- ------------------------------------------------------------

-- 002 — Enums
-- Mirrors database.md §2. Each value traces to the knowledge docs:
-- conversation_stage → docs/knowledge/conversation-flow.md
-- call_outcome       → docs/knowledge/appointment-booking.md §7
-- dq_reason          → docs/knowledge/qualification-rules.md §1

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type app_role as enum ('admin', 'viewer');
  end if;

  if not exists (select 1 from pg_type where typname = 'conversation_stage') then
    create type conversation_stage as enum (
      'opening', 'rapport', 'qualification', 'need_discovery', 'value_pitch',
      'objection_handling', 'appointment', 'confirmation', 'closing',
      'disqualified', 'ended'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'call_status') then
    create type call_status as enum ('active', 'completed', 'failed', 'abandoned');
  end if;

  if not exists (select 1 from pg_type where typname = 'call_outcome') then
    create type call_outcome as enum (
      'booked', 'partial', 'callback', 'disqualified', 'not_interested', 'abandoned'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type lead_status as enum (
      'new', 'qualifying', 'qualified', 'booked', 'disqualified', 'do_not_contact'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'home_type') then
    create type home_type as enum (
      'single_family', 'condo', 'townhome', 'mobile', 'other', 'unknown'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'credit_band') then
    create type credit_band as enum ('above_650', 'below_650', 'unsure', 'declined');
  end if;

  if not exists (select 1 from pg_type where typname = 'shading_level') then
    create type shading_level as enum ('none', 'partial', 'major', 'unknown');
  end if;

  if not exists (select 1 from pg_type where typname = 'buying_intent') then
    create type buying_intent as enum ('low', 'medium', 'high');
  end if;

  if not exists (select 1 from pg_type where typname = 'qualification_band') then
    create type qualification_band as enum ('hot', 'warm', 'cold', 'unqualified');
  end if;

  if not exists (select 1 from pg_type where typname = 'appointment_type') then
    create type appointment_type as enum ('in_home', 'virtual');
  end if;

  if not exists (select 1 from pg_type where typname = 'appointment_status') then
    create type appointment_status as enum (
      'booked', 'rescheduled', 'cancelled', 'no_show', 'held'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'speaker') then
    create type speaker as enum ('agent', 'prospect', 'system');
  end if;

  if not exists (select 1 from pg_type where typname = 'objection_class') then
    create type objection_class as enum ('early', 'late');
  end if;

  if not exists (select 1 from pg_type where typname = 'dq_reason') then
    create type dq_reason as enum (
      'not_homeowner', 'no_roof_ownership', 'bill_under_60', 'moving_under_6_months',
      'minor', 'do_not_contact', 'wrong_number', 'other'
    );
  end if;
end $$;

-- ------------------------------------------------------------
-- 003_profiles.sql
-- ------------------------------------------------------------

-- 003 — Dashboard admins
-- claude.md §10: "No public login." A row here is what makes an auth.users
-- record able to see anything; without one, RLS returns nothing.

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        app_role not null default 'viewer',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table profiles is
  'Dashboard users. Invite-only: rows are created by an admin, never by signup.';

-- ------------------------------------------------------------
-- 004_campaigns.sql
-- ------------------------------------------------------------

-- 004 — Campaigns
-- "Campaign Name" is the first field on the script's customer-details form.

create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 005_agent_settings.sql
-- ------------------------------------------------------------

-- 005 — Agent settings (prompt editor, voice settings, agent settings)
-- Created before `calls` because calls.agent_settings_id references it.
--
-- Pinning the configuration to each call means editing a prompt never
-- retroactively changes the record of how a past conversation was produced.

create table if not exists agent_settings (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  is_active           boolean not null default false,

  -- Identity: fills the [UNKNOWN] placeholders in company-context.md §8.
  company_name        text,
  agent_display_name  text,
  consultant_name     text,
  service_area        text,

  -- Prompt
  system_prompt       text not null,
  stage_prompts       jsonb not null default '{}'::jsonb,

  -- LLM
  llm_model           text not null default 'glm-4.5-flash',
  temperature         numeric(3,2) not null default 0.6,
  max_tokens          int not null default 300,

  -- Voice (D8: browser speech for MVP)
  tts_provider        text not null default 'browser',
  tts_voice_id        text,
  tts_speed           numeric(3,2) not null default 1.0,
  stt_provider        text not null default 'browser',
  stt_language        text not null default 'en-US',
  barge_in_enabled    boolean not null default true,
  silence_timeout_ms  int not null default 6000,

  -- Booking (appointment-booking.md §3)
  booking_horizon_days int not null default 14,
  slot_minutes         int not null default 45,
  morning_window       text not null default '09:00-12:00',
  afternoon_window     text not null default '13:00-18:00',

  version             int not null default 1,
  updated_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Exactly one active configuration at a time.
create unique index if not exists agent_settings_one_active
  on agent_settings(is_active) where is_active;

-- ------------------------------------------------------------
-- 006_leads.sql
-- ------------------------------------------------------------

-- 006 — Leads (the live lead object)
-- Every field in claude.md §7, plus the script's "Qualifying Notes" block.
--
-- qualification_score / qualification_band / status are written ONLY by the
-- backend scoring service. The model proposes; the server computes.

create table if not exists leads (
  id                      uuid primary key default gen_random_uuid(),
  campaign_id             uuid references campaigns(id) on delete set null,

  -- Customer details
  name                    text,
  phone                   text,
  email                   text,
  address                 text,
  timezone                text,

  -- Qualification (qualification-rules.md)
  homeowner_confirmed     boolean,
  home_type               home_type   not null default 'unknown',
  owns_roof               boolean,
  monthly_bill            numeric(10,2),
  bill_over_150           boolean,
  utility_provider        text,
  roof_type               text,
  roof_condition          text,
  shading                 shading_level not null default 'unknown',
  credit_score_band       credit_band   not null default 'unsure',
  taxable_income_over_45k boolean,
  already_has_solar       boolean,
  moving_timeline_months  int,
  has_tenant              boolean,

  -- Decision makers: [{ name, relationship, will_attend }]
  decision_makers         jsonb not null default '[]'::jsonb,

  -- Derived signals
  buying_intent           buying_intent not null default 'low',
  qualification_score     int not null default 0
                            check (qualification_score between 0 and 100),
  qualification_band      qualification_band not null default 'unqualified',
  pain_points             jsonb not null default '[]'::jsonb,

  -- Lifecycle
  status                  lead_status not null default 'new',
  disqualified_reason     dq_reason,
  do_not_contact          boolean not null default false,
  language                text not null default 'en',
  summary                 text,
  notes                   text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists leads_status_idx  on leads(status);
create index if not exists leads_score_idx   on leads(qualification_score desc);
create index if not exists leads_created_idx on leads(created_at desc);
create index if not exists leads_dnc_idx     on leads(do_not_contact) where do_not_contact;

-- Trigram index backing the dashboard's single search box across
-- name / phone / address / email.
create index if not exists leads_search_idx on leads using gin (
  (
    coalesce(name, '') || ' ' || coalesce(phone, '') || ' ' ||
    coalesce(address, '') || ' ' || coalesce(email, '')
  ) gin_trgm_ops
);

-- ------------------------------------------------------------
-- 007_calls.sql
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- 008_transcript_turns.sql
-- ------------------------------------------------------------

-- 008 — Transcript turns
-- Append-only, one row per utterance.
--
-- Under D8 the agent's audio cannot be captured (browser speechSynthesis has no
-- Web Audio node), so this table IS the agent's side of the recording. It is
-- not merely a convenience — losing it loses half the call.

create table if not exists transcript_turns (
  id             bigserial primary key,
  call_id        uuid not null references calls(id) on delete cascade,
  turn_index     int  not null,
  speaker        speaker not null,
  content        text not null,
  stage          conversation_stage not null,

  -- Speech metadata
  stt_confidence real,
  audio_start_ms int,
  audio_end_ms   int,
  latency_ms     int,   -- end-of-speech → first audio out; tracked per turn

  -- Model metadata
  llm_tokens_in  int,
  llm_tokens_out int,

  created_at     timestamptz not null default now(),
  unique (call_id, turn_index)
);

create index if not exists transcript_call_idx on transcript_turns(call_id, turn_index);
create index if not exists transcript_fts_idx
  on transcript_turns using gin (to_tsvector('english', content));

-- ------------------------------------------------------------
-- 009_recordings.sql
-- ------------------------------------------------------------

-- 009 — Recordings
-- Audio lives in Storage; this table is the pointer plus metadata.
--
-- MVP records the prospect only (channels = 'prospect'). See implementation.md
-- R13 — browser speechSynthesis output cannot be captured into Web Audio, so
-- the agent's voice is unrecoverable as audio. Upgrading to a streaming TTS
-- provider restores 'mixed' with no schema change.

create table if not exists recordings (
  id               uuid primary key default gen_random_uuid(),
  call_id          uuid not null references calls(id) on delete cascade,
  storage_path     text not null,
  mime_type        text not null default 'audio/webm',
  duration_seconds int,
  size_bytes       bigint,
  channels         text not null default 'prospect'
                     check (channels in ('prospect', 'agent', 'mixed')),
  upload_status    text not null default 'pending'
                     check (upload_status in ('pending', 'complete', 'failed', 'expired')),
  created_at       timestamptz not null default now()
);

create index if not exists recordings_call_idx on recordings(call_id);

-- ------------------------------------------------------------
-- 010_appointments.sql
-- ------------------------------------------------------------

-- 010 — Appointments
-- The five recap flags come from sales-script.md §8. They are not decoration:
-- the closing recap is where the prospect is told to have their bill ready and
-- to have all decision makers present, which is what makes the appointment
-- hold. A booking without them is a booking that no-shows.

create table if not exists appointments (
  id                      uuid primary key default gen_random_uuid(),
  lead_id                 uuid not null references leads(id) on delete cascade,
  call_id                 uuid references calls(id) on delete set null,

  scheduled_at            timestamptz not null,
  timezone                text not null,
  appointment_type        appointment_type not null default 'in_home',
  address                 text not null,
  consultant_name         text,
  language                text not null default 'en',
  status                  appointment_status not null default 'booked',

  decision_makers         jsonb not null default '[]'::jsonb,
  decision_makers_present boolean not null default false,
  confirmation_phone      text,
  conflict_checked        boolean not null default false,

  -- The five §8 recap flags
  recap_details_given        boolean not null default false,
  reminded_confirmation_call boolean not null default false,
  reminded_utility_bill      boolean not null default false,
  reminded_decision_makers   boolean not null default false,
  reminded_no_cost           boolean not null default false,

  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists appointments_scheduled_idx on appointments(scheduled_at);
create index if not exists appointments_lead_idx      on appointments(lead_id);

-- A row can only be 'booked' once the whole close actually happened.
-- Enforced in the database so a bug in the agent cannot fake a booking.
alter table appointments drop constraint if exists booked_requires_full_recap;
alter table appointments add constraint booked_requires_full_recap check (
  status <> 'booked' or (
    recap_details_given
    and reminded_confirmation_call
    and reminded_utility_bill
    and reminded_decision_makers
    and reminded_no_cost
    and conflict_checked
  )
);

-- ------------------------------------------------------------
-- 011_objection_events.sql
-- ------------------------------------------------------------

-- 011 — Objection events
-- objection_id matches the IDs in docs/knowledge/objection-handling.md,
-- e.g. 'early.not_interested' or 'late.12'. Powers the top-objections panel.

create table if not exists objection_events (
  id              bigserial primary key,
  call_id         uuid not null references calls(id) on delete cascade,
  lead_id         uuid not null references leads(id) on delete cascade,
  objection_id    text not null,
  objection_class objection_class not null,
  quote           text not null,   -- verbatim prospect wording
  stage_at        conversation_stage not null,
  resolved        boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists objection_call_idx on objection_events(call_id);
create index if not exists objection_id_idx   on objection_events(objection_id);

-- ------------------------------------------------------------
-- 012_call_events.sql
-- ------------------------------------------------------------

-- 012 — Call events (analytics + audit trail)
-- Types: stage_change | dq | fallback_used | stt_error | llm_error |
--        tts_error | consent | barge_in

create table if not exists call_events (
  id         bigserial primary key,
  call_id    uuid not null references calls(id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists call_events_call_idx on call_events(call_id, created_at);
create index if not exists call_events_type_idx on call_events(type);

-- ------------------------------------------------------------
-- 013_knowledge_documents.sql
-- ------------------------------------------------------------

-- 013 — Knowledge manager
-- Seeded from docs/knowledge/*.md. The files are the source of truth at first
-- deploy; after that these rows win and the dashboard edits them. Every save
-- snapshots the previous version so a bad prompt edit is one click to undo.

create table if not exists knowledge_documents (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  content     text not null,
  is_active   boolean not null default true,
  version     int not null default 1,
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create table if not exists knowledge_document_versions (
  id          bigserial primary key,
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  version     int not null,
  content     text not null,
  updated_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  unique (document_id, version)
);

-- ------------------------------------------------------------
-- 014_audit_log.sql
-- ------------------------------------------------------------

-- 014 — Audit log
-- Who changed the prompt, who exported leads, who activated a config.
-- Written by the service role only; admin-readable.

create table if not exists audit_log (
  id         bigserial primary key,
  actor_id   uuid references profiles(id),
  action     text not null,   -- 'knowledge.update', 'settings.activate', 'lead.export'
  entity     text not null,
  entity_id  text,
  diff       jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_actor_idx on audit_log(actor_id, created_at desc);

-- ------------------------------------------------------------
-- 015_triggers.sql
-- ------------------------------------------------------------

-- 015 — Triggers

-- updated_at maintenance
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists leads_updated on leads;
create trigger leads_updated before update on leads
  for each row execute function set_updated_at();

drop trigger if exists appointments_updated on appointments;
create trigger appointments_updated before update on appointments
  for each row execute function set_updated_at();

drop trigger if exists agent_settings_updated on agent_settings;
create trigger agent_settings_updated before update on agent_settings
  for each row execute function set_updated_at();


-- Snapshot knowledge edits before overwriting them.
create or replace function snapshot_knowledge() returns trigger
language plpgsql as $$
begin
  if new.content is distinct from old.content then
    insert into knowledge_document_versions (document_id, version, content, updated_by)
    values (old.id, old.version, old.content, new.updated_by);
    new.version = old.version + 1;
    new.updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists knowledge_versioning on knowledge_documents;
create trigger knowledge_versioning before update on knowledge_documents
  for each row execute function snapshot_knowledge();


-- Do-not-contact is irreversible from the application.
-- fallback-responses.md §4: a removal request is unconditional and permanent.
-- Putting the guarantee in the database means no future code path can undo it.
create or replace function guard_dnc() returns trigger
language plpgsql as $$
begin
  if old.do_not_contact and not new.do_not_contact then
    raise exception 'do_not_contact cannot be cleared';
  end if;
  return new;
end $$;

drop trigger if exists leads_dnc_guard on leads;
create trigger leads_dnc_guard before update on leads
  for each row execute function guard_dnc();

-- ------------------------------------------------------------
-- 016_rls.sql
-- ------------------------------------------------------------

-- 016 — Row Level Security
--
-- Default deny everywhere. The backend uses the service-role key, which
-- bypasses RLS; these policies govern the dashboard's authenticated reads.
--
-- Note what has NO insert/update policy: leads, calls, transcript_turns,
-- recordings, appointments, objection_events, call_events. Those are writable
-- only by the service role. Even a signed-in admin cannot edit a transcript.

alter table profiles                    enable row level security;
alter table campaigns                   enable row level security;
alter table leads                       enable row level security;
alter table calls                       enable row level security;
alter table transcript_turns            enable row level security;
alter table recordings                  enable row level security;
alter table appointments                enable row level security;
alter table objection_events            enable row level security;
alter table call_events                 enable row level security;
alter table knowledge_documents         enable row level security;
alter table knowledge_document_versions enable row level security;
alter table agent_settings              enable row level security;
alter table audit_log                   enable row level security;


-- security definer + a pinned search_path: without the pin, a caller could
-- shadow `profiles` with their own table and grant themselves access.
create or replace function is_dashboard_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and is_active and role = 'admin'
  );
$$;


-- Read access for any active dashboard user
drop policy if exists read_leads on leads;
create policy read_leads on leads for select using (is_dashboard_user());

drop policy if exists read_calls on calls;
create policy read_calls on calls for select using (is_dashboard_user());

drop policy if exists read_turns on transcript_turns;
create policy read_turns on transcript_turns for select using (is_dashboard_user());

drop policy if exists read_recordings on recordings;
create policy read_recordings on recordings for select using (is_dashboard_user());

drop policy if exists read_appts on appointments;
create policy read_appts on appointments for select using (is_dashboard_user());

drop policy if exists read_objections on objection_events;
create policy read_objections on objection_events for select using (is_dashboard_user());

drop policy if exists read_events on call_events;
create policy read_events on call_events for select using (is_dashboard_user());

drop policy if exists read_campaigns on campaigns;
create policy read_campaigns on campaigns for select using (is_dashboard_user());

drop policy if exists read_knowledge on knowledge_documents;
create policy read_knowledge on knowledge_documents for select using (is_dashboard_user());

drop policy if exists read_knowledge_versions on knowledge_document_versions;
create policy read_knowledge_versions on knowledge_document_versions
  for select using (is_dashboard_user());

drop policy if exists read_settings on agent_settings;
create policy read_settings on agent_settings for select using (is_dashboard_user());

drop policy if exists read_own_profile on profiles;
create policy read_own_profile on profiles
  for select using (id = auth.uid() or is_admin());


-- Dashboard writes: admins only, and only to configuration tables.
drop policy if exists admin_write_knowledge on knowledge_documents;
create policy admin_write_knowledge on knowledge_documents
  for all using (is_admin()) with check (is_admin());

drop policy if exists admin_write_settings on agent_settings;
create policy admin_write_settings on agent_settings
  for all using (is_admin()) with check (is_admin());

drop policy if exists admin_write_campaigns on campaigns;
create policy admin_write_campaigns on campaigns
  for all using (is_admin()) with check (is_admin());

drop policy if exists admin_read_audit on audit_log;
create policy admin_read_audit on audit_log for select using (is_admin());

-- ------------------------------------------------------------
-- 017_storage.sql
-- ------------------------------------------------------------

-- 017 — Storage bucket for call recordings
--
-- Private. The dashboard plays audio through short-lived signed URLs minted by
-- the backend, never a public URL — these are recordings of real people's
-- voices and addresses.
--
-- Path convention: call-recordings/{yyyy}/{mm}/{call_id}/{channels}.webm

insert into storage.buckets (id, name, public)
values ('call-recordings', 'call-recordings', false)
on conflict (id) do nothing;

drop policy if exists read_recordings_bucket on storage.objects;
create policy read_recordings_bucket on storage.objects
  for select using (bucket_id = 'call-recordings' and is_dashboard_user());

-- ------------------------------------------------------------
-- 018_views.sql
-- ------------------------------------------------------------

-- 018 — Analytics views
-- security_invoker = on so the views inherit the caller's RLS rather than the
-- view owner's. Without it a view is a hole straight through the policies.

create or replace view v_call_funnel with (security_invoker = on) as
select
  date_trunc('day', started_at)                       as day,
  count(*)                                            as calls,
  count(*) filter (where outcome = 'booked')          as booked,
  count(*) filter (where outcome = 'disqualified')    as disqualified,
  count(*) filter (where outcome = 'not_interested')  as not_interested,
  round(avg(duration_seconds))                        as avg_duration_s,
  round(avg(qualification_score))                     as avg_score
from calls
where status = 'completed'
group by 1
order by 1 desc;

create or replace view v_stage_dropoff with (security_invoker = on) as
select stage, count(*) as reached
from calls
group by stage;

create or replace view v_top_objections with (security_invoker = on) as
select
  objection_id,
  objection_class,
  count(*)                          as hits,
  count(*) filter (where resolved)  as resolved
from objection_events
group by 1, 2
order by hits desc;

-- ------------------------------------------------------------
-- 019_seed_knowledge.sql
-- ------------------------------------------------------------

-- 019 — Knowledge document placeholders
--
-- Creates the seven rows with their slugs and titles. The markdown bodies are
-- loaded from docs/knowledge/*.md by `pnpm --filter backend seed:knowledge`
-- rather than being pasted here: the files are the source of truth at first
-- deploy, and embedding ~40KB of prose in a migration would make every future
-- edit a schema change.

insert into knowledge_documents (slug, title, content, is_active)
values
  ('company-context',    'Company Context',    '<!-- pending seed -->', true),
  ('sales-script',       'Sales Script',       '<!-- pending seed -->', true),
  ('qualification-rules','Qualification Rules','<!-- pending seed -->', true),
  ('objection-handling', 'Objection Handling', '<!-- pending seed -->', true),
  ('appointment-booking','Appointment Booking','<!-- pending seed -->', true),
  ('conversation-flow',  'Conversation Flow',  '<!-- pending seed -->', true),
  ('fallback-responses', 'Fallback Responses', '<!-- pending seed -->', true)
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- 020_seed_agent_settings.sql
-- ------------------------------------------------------------

-- 020 — Default agent configuration
--
-- The identity fields are intentionally left NULL. company-context.md §8 lists
-- them as [UNKNOWN], and the agent must use its fallback response rather than
-- invent a company or consultant name. They are populated from the dashboard
-- (or backend/.env on first boot) before any real call.

insert into agent_settings (
  name,
  is_active,
  system_prompt,
  llm_model,
  temperature,
  max_tokens,
  tts_provider,
  stt_provider
)
select
  'default',
  true,
  -- Placeholder. M2 assembles the real prompt from the knowledge documents;
  -- this exists so the NOT NULL constraint holds and M1 can boot.
  '<!-- assembled at runtime from knowledge_documents in M2 -->',
  'glm-4.5-flash',
  0.6,
  300,
  'browser',
  'browser'
where not exists (select 1 from agent_settings where is_active);
