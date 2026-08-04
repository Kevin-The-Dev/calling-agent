-- 004 — Campaigns
-- "Campaign Name" is the first field on the script's customer-details form.

create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
