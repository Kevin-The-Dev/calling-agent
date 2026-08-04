-- 016 — Row Level Security
--
-- Default deny everywhere. The backend uses the service-role key, which
-- bypasses RLS; these policies govern the dashboard's authenticated reads.
--
-- Note what has NO insert/update policy: leads, calls, transcript_turns,
-- recordings, appointments, objection_events, call_events. Those are writable
-- only by the service role. Even a signed-in admin cannot edit a transcript.

alter table profiles                    enable row level security;
alter table campaigns                   enable row level security;
alter table leads                       enable row level security;
alter table calls                       enable row level security;
alter table transcript_turns            enable row level security;
alter table recordings                  enable row level security;
alter table appointments                enable row level security;
alter table objection_events            enable row level security;
alter table call_events                 enable row level security;
alter table knowledge_documents         enable row level security;
alter table knowledge_document_versions enable row level security;
alter table agent_settings              enable row level security;
alter table audit_log                   enable row level security;


-- security definer + a pinned search_path: without the pin, a caller could
-- shadow `profiles` with their own table and grant themselves access.
create or replace function is_dashboard_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and is_active and role = 'admin'
  );
$$;


-- Read access for any active dashboard user
drop policy if exists read_leads on leads;
create policy read_leads on leads for select using (is_dashboard_user());

drop policy if exists read_calls on calls;
create policy read_calls on calls for select using (is_dashboard_user());

drop policy if exists read_turns on transcript_turns;
create policy read_turns on transcript_turns for select using (is_dashboard_user());

drop policy if exists read_recordings on recordings;
create policy read_recordings on recordings for select using (is_dashboard_user());

drop policy if exists read_appts on appointments;
create policy read_appts on appointments for select using (is_dashboard_user());

drop policy if exists read_objections on objection_events;
create policy read_objections on objection_events for select using (is_dashboard_user());

drop policy if exists read_events on call_events;
create policy read_events on call_events for select using (is_dashboard_user());

drop policy if exists read_campaigns on campaigns;
create policy read_campaigns on campaigns for select using (is_dashboard_user());

drop policy if exists read_knowledge on knowledge_documents;
create policy read_knowledge on knowledge_documents for select using (is_dashboard_user());

drop policy if exists read_knowledge_versions on knowledge_document_versions;
create policy read_knowledge_versions on knowledge_document_versions
  for select using (is_dashboard_user());

drop policy if exists read_settings on agent_settings;
create policy read_settings on agent_settings for select using (is_dashboard_user());

drop policy if exists read_own_profile on profiles;
create policy read_own_profile on profiles
  for select using (id = auth.uid() or is_admin());


-- Dashboard writes: admins only, and only to configuration tables.
drop policy if exists admin_write_knowledge on knowledge_documents;
create policy admin_write_knowledge on knowledge_documents
  for all using (is_admin()) with check (is_admin());

drop policy if exists admin_write_settings on agent_settings;
create policy admin_write_settings on agent_settings
  for all using (is_admin()) with check (is_admin());

drop policy if exists admin_write_campaigns on campaigns;
create policy admin_write_campaigns on campaigns
  for all using (is_admin()) with check (is_admin());

drop policy if exists admin_read_audit on audit_log;
create policy admin_read_audit on audit_log for select using (is_admin());
