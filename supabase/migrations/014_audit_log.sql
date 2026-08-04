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
