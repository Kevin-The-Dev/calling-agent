-- 003 — Dashboard admins
-- claude.md §10: "No public login." A row here is what makes an auth.users
-- record able to see anything; without one, RLS returns nothing.

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        app_role not null default 'viewer',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table profiles is
  'Dashboard users. Invite-only: rows are created by an admin, never by signup.';
