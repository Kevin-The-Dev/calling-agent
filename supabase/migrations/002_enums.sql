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
