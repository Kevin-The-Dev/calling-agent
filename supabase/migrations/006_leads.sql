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
