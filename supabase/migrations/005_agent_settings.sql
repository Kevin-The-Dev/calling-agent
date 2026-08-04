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
