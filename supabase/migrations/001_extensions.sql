-- 001 — Extensions
-- pgcrypto : gen_random_uuid() for primary keys
-- pg_trgm  : fuzzy search over lead name / phone / address in the dashboard

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
