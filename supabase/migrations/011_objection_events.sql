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
