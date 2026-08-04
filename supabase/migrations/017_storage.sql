-- 017 — Storage bucket for call recordings
--
-- Private. The dashboard plays audio through short-lived signed URLs minted by
-- the backend, never a public URL — these are recordings of real people's
-- voices and addresses.
--
-- Path convention: call-recordings/{yyyy}/{mm}/{call_id}/{channels}.webm

insert into storage.buckets (id, name, public)
values ('call-recordings', 'call-recordings', false)
on conflict (id) do nothing;

drop policy if exists read_recordings_bucket on storage.objects;
create policy read_recordings_bucket on storage.objects
  for select using (bucket_id = 'call-recordings' and is_dashboard_user());
