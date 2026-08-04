-- 015 — Triggers

-- updated_at maintenance
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists leads_updated on leads;
create trigger leads_updated before update on leads
  for each row execute function set_updated_at();

drop trigger if exists appointments_updated on appointments;
create trigger appointments_updated before update on appointments
  for each row execute function set_updated_at();

drop trigger if exists agent_settings_updated on agent_settings;
create trigger agent_settings_updated before update on agent_settings
  for each row execute function set_updated_at();


-- Snapshot knowledge edits before overwriting them.
create or replace function snapshot_knowledge() returns trigger
language plpgsql as $$
begin
  if new.content is distinct from old.content then
    insert into knowledge_document_versions (document_id, version, content, updated_by)
    values (old.id, old.version, old.content, new.updated_by);
    new.version = old.version + 1;
    new.updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists knowledge_versioning on knowledge_documents;
create trigger knowledge_versioning before update on knowledge_documents
  for each row execute function snapshot_knowledge();


-- Do-not-contact is irreversible from the application.
-- fallback-responses.md §4: a removal request is unconditional and permanent.
-- Putting the guarantee in the database means no future code path can undo it.
create or replace function guard_dnc() returns trigger
language plpgsql as $$
begin
  if old.do_not_contact and not new.do_not_contact then
    raise exception 'do_not_contact cannot be cleared';
  end if;
  return new;
end $$;

drop trigger if exists leads_dnc_guard on leads;
create trigger leads_dnc_guard before update on leads
  for each row execute function guard_dnc();
