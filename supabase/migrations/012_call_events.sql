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
