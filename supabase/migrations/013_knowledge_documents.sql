-- 013 — Knowledge manager
-- Seeded from docs/knowledge/*.md. The files are the source of truth at first
-- deploy; after that these rows win and the dashboard edits them. Every save
-- snapshots the previous version so a bad prompt edit is one click to undo.

create table if not exists knowledge_documents (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  content     text not null,
  is_active   boolean not null default true,
  version     int not null default 1,
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create table if not exists knowledge_document_versions (
  id          bigserial primary key,
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  version     int not null,
  content     text not null,
  updated_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  unique (document_id, version)
);
