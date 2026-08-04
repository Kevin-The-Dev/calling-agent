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
