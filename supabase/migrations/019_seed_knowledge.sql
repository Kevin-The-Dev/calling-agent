-- 019 — Knowledge document placeholders
--
-- Creates the seven rows with their slugs and titles. The markdown bodies are
-- loaded from docs/knowledge/*.md by `pnpm --filter backend seed:knowledge`
-- rather than being pasted here: the files are the source of truth at first
-- deploy, and embedding ~40KB of prose in a migration would make every future
-- edit a schema change.

insert into knowledge_documents (slug, title, content, is_active)
values
  ('company-context',    'Company Context',    '<!-- pending seed -->', true),
  ('sales-script',       'Sales Script',       '<!-- pending seed -->', true),
  ('qualification-rules','Qualification Rules','<!-- pending seed -->', true),
  ('objection-handling', 'Objection Handling', '<!-- pending seed -->', true),
  ('appointment-booking','Appointment Booking','<!-- pending seed -->', true),
  ('conversation-flow',  'Conversation Flow',  '<!-- pending seed -->', true),
  ('fallback-responses', 'Fallback Responses', '<!-- pending seed -->', true)
on conflict (slug) do nothing;
