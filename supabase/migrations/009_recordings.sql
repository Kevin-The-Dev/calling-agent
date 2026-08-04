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
