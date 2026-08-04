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
