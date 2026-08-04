# database.md — Supabase Schema

> **Deliverable 2 of 3** (`claude.md` §16). Supabase is the CRM: leads, transcripts, recordings,
> summaries, buying intent, qualification score, appointment outcome.
> Field names trace directly to [docs/knowledge/](docs/knowledge/) — see the traceability table at
> the end.

**Stack:** Postgres 15 (Supabase) · Supabase Auth (dashboard admins only) · Supabase Storage
(recordings) · Supabase Realtime (live calls) · RLS on every table.

**Access model:** the browser **never** writes to Postgres directly. All writes go through the
`backend/` Hono API using the service-role key. The dashboard reads through RLS-protected
`SELECT`s as an authenticated admin. There is no anonymous read or write anywhere.

---

## 1. Extensions

```sql
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- fuzzy search on name/address/phone
```

---

## 2. Enums

```sql
create type app_role          as enum ('admin', 'viewer');
create type conversation_stage as enum (
  'opening','rapport','qualification','need_discovery','value_pitch',
  'objection_handling','appointment','confirmation','closing',
  'disqualified','ended'
);
create type call_status       as enum ('active','completed','failed','abandoned');
create type call_outcome      as enum (
  'booked','partial','callback','disqualified','not_interested','abandoned'
);
create type lead_status       as enum ('new','qualifying','qualified','booked','disqualified','do_not_contact');
create type home_type         as enum ('single_family','condo','townhome','mobile','other','unknown');
create type credit_band       as enum ('above_650','below_650','unsure','declined');
create type shading_level     as enum ('none','partial','major','unknown');
create type buying_intent     as enum ('low','medium','high');
create type qualification_band as enum ('hot','warm','cold','unqualified');
create type appointment_type  as enum ('in_home','virtual');
create type appointment_status as enum ('booked','rescheduled','cancelled','no_show','held');
create type speaker           as enum ('agent','prospect','system');
create type objection_class   as enum ('early','late');
create type dq_reason         as enum (
  'not_homeowner','no_roof_ownership','bill_under_60','moving_under_6_months',
  'minor','do_not_contact','wrong_number','other'
);
```

---

## 3. Tables

### 3.1 `profiles` — dashboard admins

Mirrors `auth.users`. Only rows here can sign in to the dashboard; there is **no public signup**.

```sql
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        app_role not null default 'viewer',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
```

Seeded manually (or by an invite-only backend route). A user in `auth.users` without a `profiles`
row cannot read anything.

### 3.2 `campaigns`

```sql
create table campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                    -- "Campaign Name" on the script form
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
```

### 3.3 `leads` — the live lead object

Every field in `claude.md` §7 plus the script's "Qualifying Notes" block.

```sql
create table leads (
  id                     uuid primary key default gen_random_uuid(),
  campaign_id            uuid references campaigns(id) on delete set null,

  -- Customer details (script §"Customer Details")
  name                   text,
  phone                  text,
  email                  text,
  address                text,
  timezone               text,                              -- IANA, resolved from address

  -- Qualification (qualification-rules.md)
  homeowner_confirmed    boolean,
  home_type              home_type       not null default 'unknown',
  owns_roof              boolean,
  monthly_bill           numeric(10,2),
  bill_over_150          boolean,
  utility_provider       text,
  roof_type              text,                              -- shingle, tile, flat...
  roof_condition         text,
  shading                shading_level   not null default 'unknown',
  credit_score_band      credit_band     not null default 'unsure',
  taxable_income_over_45k boolean,
  already_has_solar      boolean,
  moving_timeline_months  int,
  has_tenant             boolean,

  -- Decision makers (script §5)
  decision_makers        jsonb not null default '[]'::jsonb,  -- [{name, relationship, will_attend}]

  -- Derived signals
  buying_intent          buying_intent   not null default 'low',
  qualification_score    int             not null default 0 check (qualification_score between 0 and 100),
  qualification_band     qualification_band not null default 'unqualified',
  pain_points            jsonb not null default '[]'::jsonb,

  -- Lifecycle
  status                 lead_status     not null default 'new',
  disqualified_reason    dq_reason,
  do_not_contact         boolean         not null default false,
  language               text            not null default 'en',
  summary                text,
  notes                  text,                               -- "Extra Notes"

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index leads_status_idx        on leads(status);
create index leads_score_idx         on leads(qualification_score desc);
create index leads_created_idx       on leads(created_at desc);
create index leads_dnc_idx           on leads(do_not_contact) where do_not_contact;
create index leads_search_idx        on leads using gin ((coalesce(name,'') || ' ' || coalesce(phone,'') || ' ' || coalesce(address,'') || ' ' || coalesce(email,'')) gin_trgm_ops);
```

> `qualification_score`, `qualification_band`, and `status` are written **only** by the backend
> scoring service — never taken from the model's output.

### 3.4 `calls`

```sql
create table calls (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references leads(id) on delete cascade,
  campaign_id        uuid references campaigns(id) on delete set null,

  status             call_status not null default 'active',
  outcome            call_outcome,
  stage              conversation_stage not null default 'opening',
  return_stage       conversation_stage,                    -- set while in objection_handling

  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  duration_seconds   int generated always as
                       (extract(epoch from (ended_at - started_at))::int) stored,

  turn_count         int not null default 0,
  early_objection_count int not null default 0,
  late_objection_count  int not null default 0,

  summary            text,
  buying_intent      buying_intent not null default 'low',
  qualification_score int not null default 0,

  -- consent + compliance
  consent_given      boolean not null default false,
  consent_at         timestamptz,

  -- runtime metadata
  agent_settings_id  uuid references agent_settings(id),
  stt_provider       text,
  tts_provider       text,
  llm_model          text,
  error              text,

  created_at         timestamptz not null default now()
);

create index calls_lead_idx    on calls(lead_id);
create index calls_status_idx  on calls(status) where status = 'active';
create index calls_started_idx on calls(started_at desc);
create index calls_outcome_idx on calls(outcome);
```

The dashboard's **live calls** view subscribes via Realtime to `calls where status = 'active'`.

### 3.5 `transcript_turns`

One row per utterance. Append-only.

```sql
create table transcript_turns (
  id             bigserial primary key,
  call_id        uuid not null references calls(id) on delete cascade,
  turn_index     int  not null,
  speaker        speaker not null,
  content        text not null,
  stage          conversation_stage not null,

  -- speech metadata
  stt_confidence real,
  audio_start_ms int,                    -- offset into the recording
  audio_end_ms   int,
  latency_ms     int,                    -- end-of-speech → first TTS byte

  -- model metadata
  llm_tokens_in  int,
  llm_tokens_out int,

  created_at     timestamptz not null default now(),
  unique (call_id, turn_index)
);

create index transcript_call_idx on transcript_turns(call_id, turn_index);
create index transcript_fts_idx  on transcript_turns using gin (to_tsvector('english', content));
```

### 3.6 `recordings`

Audio lives in Storage; this table holds the pointer and metadata.

```sql
create table recordings (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid not null references calls(id) on delete cascade,
  storage_path   text not null,          -- call-recordings/{call_id}/mixed.webm
  mime_type      text not null default 'audio/webm',
  duration_seconds int,
  size_bytes     bigint,
  channels       text not null default 'prospect',-- prospect | mixed | agent
  upload_status  text not null default 'pending', -- pending | complete | failed
  created_at     timestamptz not null default now()
);

create index recordings_call_idx on recordings(call_id);
```

### 3.7 `appointments`

```sql
create table appointments (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid not null references leads(id) on delete cascade,
  call_id             uuid references calls(id) on delete set null,

  scheduled_at        timestamptz not null,
  timezone            text not null,
  appointment_type    appointment_type not null default 'in_home',
  address             text not null,
  consultant_name     text,
  language            text not null default 'en',
  status              appointment_status not null default 'booked',

  decision_makers     jsonb not null default '[]'::jsonb,
  decision_makers_present boolean not null default false,
  confirmation_phone  text,
  conflict_checked    boolean not null default false,

  -- the five §8 recap flags
  recap_details_given        boolean not null default false,
  reminded_confirmation_call boolean not null default false,
  reminded_utility_bill      boolean not null default false,
  reminded_decision_makers   boolean not null default false,
  reminded_no_cost           boolean not null default false,

  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index appointments_scheduled_idx on appointments(scheduled_at);
create index appointments_lead_idx      on appointments(lead_id);
```

A `booked` row requires all five recap flags true plus `conflict_checked` — enforced in the backend
service and by this constraint:

```sql
alter table appointments add constraint booked_requires_full_recap check (
  status <> 'booked' or (
    recap_details_given and reminded_confirmation_call and reminded_utility_bill
    and reminded_decision_makers and reminded_no_cost and conflict_checked
  )
);
```

### 3.8 `objection_events`

```sql
create table objection_events (
  id            bigserial primary key,
  call_id       uuid not null references calls(id) on delete cascade,
  lead_id       uuid not null references leads(id) on delete cascade,
  objection_id  text not null,             -- 'early.not_interested', 'late.12', ...
  objection_class objection_class not null,
  quote         text not null,             -- verbatim prospect wording
  stage_at      conversation_stage not null,
  resolved      boolean not null default false,
  created_at    timestamptz not null default now()
);

create index objection_call_idx on objection_events(call_id);
create index objection_id_idx   on objection_events(objection_id);
```

Powers the "top objections" analytics panel.

### 3.9 `call_events` — analytics + audit trail

```sql
create table call_events (
  id         bigserial primary key,
  call_id    uuid not null references calls(id) on delete cascade,
  type       text not null,   -- stage_change | dq | fallback_used | stt_error | llm_error | tts_error | consent
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index call_events_call_idx on call_events(call_id, created_at);
create index call_events_type_idx on call_events(type);
```

### 3.10 `knowledge_documents` + versions — dashboard knowledge manager

```sql
create table knowledge_documents (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,   -- 'sales-script', 'objection-handling', ...
  title       text not null,
  content     text not null,          -- markdown
  is_active   boolean not null default true,
  version     int not null default 1,
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create table knowledge_document_versions (
  id           bigserial primary key,
  document_id  uuid not null references knowledge_documents(id) on delete cascade,
  version      int not null,
  content      text not null,
  updated_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  unique (document_id, version)
);
```

Seeded from `docs/knowledge/*.md`. The files on disk are the source of truth at first deploy; after
that the database rows win and the dashboard edits them. Every save snapshots the previous version.

### 3.11 `agent_settings` — prompt editor, voice settings, agent settings

```sql
create table agent_settings (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  is_active           boolean not null default false,

  -- identity (fills the [UNKNOWN] placeholders)
  company_name        text,
  agent_display_name  text,
  consultant_name     text,
  service_area        text,

  -- prompt
  system_prompt       text not null,
  stage_prompts       jsonb not null default '{}'::jsonb,   -- { stage: instructions }

  -- llm
  llm_model           text not null default 'kimi-k2',
  temperature         numeric(3,2) not null default 0.6,
  max_tokens          int not null default 300,

  -- voice
  tts_provider        text,
  tts_voice_id        text,
  tts_speed           numeric(3,2) not null default 1.0,
  stt_provider        text,
  stt_language        text not null default 'en-US',
  barge_in_enabled    boolean not null default true,
  silence_timeout_ms  int not null default 6000,

  -- booking
  booking_horizon_days int not null default 14,
  slot_minutes         int not null default 45,
  morning_window       text not null default '09:00-12:00',
  afternoon_window     text not null default '13:00-18:00',

  version             int not null default 1,
  updated_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index agent_settings_one_active on agent_settings(is_active) where is_active;
```

Exactly one active configuration at a time. `calls.agent_settings_id` pins which config ran, so a
prompt change never rewrites the history of past calls.

### 3.12 `audit_log`

```sql
create table audit_log (
  id         bigserial primary key,
  actor_id   uuid references profiles(id),
  action     text not null,          -- 'knowledge.update', 'settings.activate', 'lead.export', ...
  entity     text not null,
  entity_id  text,
  diff       jsonb,
  created_at timestamptz not null default now()
);
```

---

## 4. Triggers

```sql
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger leads_updated        before update on leads
  for each row execute function set_updated_at();
create trigger appointments_updated before update on appointments
  for each row execute function set_updated_at();
create trigger agent_settings_updated before update on agent_settings
  for each row execute function set_updated_at();

-- snapshot knowledge edits
create or replace function snapshot_knowledge() returns trigger
language plpgsql as $$
begin
  if new.content is distinct from old.content then
    insert into knowledge_document_versions(document_id, version, content, updated_by)
    values (old.id, old.version, old.content, new.updated_by);
    new.version = old.version + 1;
    new.updated_at = now();
  end if;
  return new;
end $$;

create trigger knowledge_versioning before update on knowledge_documents
  for each row execute function snapshot_knowledge();

-- do-not-contact is irreversible from the app
create or replace function guard_dnc() returns trigger
language plpgsql as $$
begin
  if old.do_not_contact and not new.do_not_contact then
    raise exception 'do_not_contact cannot be cleared';
  end if;
  return new;
end $$;

create trigger leads_dnc_guard before update on leads
  for each row execute function guard_dnc();
```

---

## 5. Row Level Security

**Default deny everywhere.** The backend uses the service-role key, which bypasses RLS; these
policies govern the dashboard's authenticated reads only.

```sql
alter table profiles                   enable row level security;
alter table campaigns                  enable row level security;
alter table leads                      enable row level security;
alter table calls                      enable row level security;
alter table transcript_turns           enable row level security;
alter table recordings                 enable row level security;
alter table appointments               enable row level security;
alter table objection_events           enable row level security;
alter table call_events                enable row level security;
alter table knowledge_documents        enable row level security;
alter table knowledge_document_versions enable row level security;
alter table agent_settings             enable row level security;
alter table audit_log                  enable row level security;

-- helper: is the caller an active dashboard user?
create or replace function is_dashboard_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active
  );
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active and role = 'admin'
  );
$$;

-- read access for any active dashboard user
create policy read_leads       on leads             for select using (is_dashboard_user());
create policy read_calls       on calls             for select using (is_dashboard_user());
create policy read_turns       on transcript_turns  for select using (is_dashboard_user());
create policy read_recordings  on recordings        for select using (is_dashboard_user());
create policy read_appts       on appointments      for select using (is_dashboard_user());
create policy read_objections  on objection_events  for select using (is_dashboard_user());
create policy read_events      on call_events       for select using (is_dashboard_user());
create policy read_campaigns   on campaigns         for select using (is_dashboard_user());
create policy read_knowledge   on knowledge_documents for select using (is_dashboard_user());
create policy read_settings    on agent_settings    for select using (is_dashboard_user());

-- own profile
create policy read_own_profile on profiles for select using (id = auth.uid() or is_admin());

-- writes from the dashboard: admins only, and only for config tables
create policy admin_write_knowledge on knowledge_documents for all
  using (is_admin()) with check (is_admin());
create policy admin_write_settings  on agent_settings for all
  using (is_admin()) with check (is_admin());
create policy admin_write_campaigns on campaigns for all
  using (is_admin()) with check (is_admin());

-- audit log is admin-read, service-role-write only
create policy admin_read_audit on audit_log for select using (is_admin());
```

No `INSERT`/`UPDATE` policy exists on `leads`, `calls`, `transcript_turns`, `recordings`,
`appointments`, `objection_events`, or `call_events` — those tables are writable **only** by the
service role in `backend/`.

---

## 6. Storage

```sql
insert into storage.buckets (id, name, public)
values ('call-recordings', 'call-recordings', false)
on conflict do nothing;

create policy read_recordings_bucket on storage.objects for select
  using (bucket_id = 'call-recordings' and is_dashboard_user());
```

- **Private bucket.** The dashboard plays audio through short-lived signed URLs (60s TTL) minted by
  the backend — never a public URL.
- Path convention: `call-recordings/{yyyy}/{mm}/{call_id}/{channels}.webm`
- **MVP records the prospect only** (`channels = 'prospect'`). Browser `speechSynthesis` output
  cannot be captured into Web Audio, so the agent's voice is not recoverable as audio — its side of
  the call lives in `transcript_turns`. Upgrading to a streaming TTS provider restores a `mixed`
  two-sided recording with no schema change. See implementation.md R13.
- Uploaded in chunks by the backend as the call proceeds; finalized on call end.
- Retention: configurable; default **180 days**, then a scheduled job deletes the object and sets
  `recordings.upload_status = 'expired'`. Transcripts are kept.

---

## 7. Analytics views

```sql
create view v_call_funnel as
select
  date_trunc('day', started_at) as day,
  count(*)                                             as calls,
  count(*) filter (where outcome = 'booked')           as booked,
  count(*) filter (where outcome = 'disqualified')     as disqualified,
  count(*) filter (where outcome = 'not_interested')   as not_interested,
  round(avg(duration_seconds))                         as avg_duration_s,
  round(avg(qualification_score))                      as avg_score
from calls
where status = 'completed'
group by 1 order by 1 desc;

create view v_stage_dropoff as
select stage, count(*) as reached
from calls group by stage;

create view v_top_objections as
select objection_id, objection_class, count(*) as hits,
       count(*) filter (where resolved) as resolved
from objection_events group by 1,2 order by hits desc;
```

Views inherit RLS from their base tables.

---

## 8. Migration order

```
001_extensions.sql
002_enums.sql
003_profiles.sql
004_campaigns.sql
005_agent_settings.sql        -- before calls (FK target)
006_leads.sql
007_calls.sql
008_transcript_turns.sql
009_recordings.sql
010_appointments.sql
011_objection_events.sql
012_call_events.sql
013_knowledge_documents.sql
014_audit_log.sql
015_triggers.sql
016_rls.sql
017_storage.sql
018_views.sql
019_seed_knowledge.sql        -- loads docs/knowledge/*.md
020_seed_agent_settings.sql
```

Managed with the Supabase CLI (`supabase/migrations/`). Types are generated into
`backend/src/types/database.ts` and re-exported to the frontend via
`supabase gen types typescript`.

---

## 9. Traceability

| Requirement | Where it lives |
| --- | --- |
| `claude.md` §7 lead object — name, phone, email, address, monthly bill, utility provider, homeowner, roof type, roof ownership, credit score, decision maker, appointment, buying intent, qualification score, objections, summary | `leads` (+ `appointments`, `objection_events`) |
| §9 store leads, transcripts, recordings, summaries, buying intent, qualification score, appointment outcome | `leads`, `transcript_turns`, `recordings` + Storage, `calls.summary`, `calls.buying_intent`, `calls.qualification_score`, `appointments.status` |
| §10 dashboard — lead list, profile, recordings, transcripts, analytics, live calls, search, knowledge manager, prompt editor, voice + agent settings | `leads`, `calls`, `recordings`, `transcript_turns`, `v_*` views, Realtime on `calls`, `leads_search_idx`, `knowledge_documents`, `agent_settings` |
| §11 security — no exposed keys, validated input | service-role writes only, default-deny RLS, private bucket, signed URLs |
| Script "Qualifying Notes" form | `leads` + `appointments` recap flags |
| `qualification-rules.md` scoring + DQ | `leads.qualification_score`, `qualification_band`, `disqualified_reason` |
| `conversation-flow.md` stages | `calls.stage`, `calls.return_stage`, `transcript_turns.stage` |
