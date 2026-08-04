#!/usr/bin/env node
/**
 * Concatenates supabase/migrations/*.sql into one paste-ready file.
 *
 * Why this exists: applying migrations with the Supabase CLI needs the database
 * password, which is a credential nobody should have to hand around just to
 * stand a project up. The bundle can be pasted straight into the Supabase SQL
 * Editor instead, which authenticates through the browser session.
 *
 * Every migration is written to be idempotent (`if not exists`,
 * `create or replace`, `drop policy if exists`), so re-running the bundle is
 * safe.
 *
 *   node scripts/build-migration-bundle.mjs
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const outputPath = join(root, 'supabase', 'bundle.sql');

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

if (files.length === 0) {
  console.error('No migrations found in supabase/migrations');
  process.exit(1);
}

const parts = [
  '-- ============================================================',
  '-- GENERATED FILE — do not edit.',
  '-- Source: supabase/migrations/*.sql',
  '-- Rebuild: node scripts/build-migration-bundle.mjs',
  '--',
  '-- Paste into the Supabase SQL Editor and run. Idempotent: safe to re-run.',
  '-- ============================================================',
  '',
];

for (const file of files) {
  const sql = await readFile(join(migrationsDir, file), 'utf8');
  parts.push(
    '-- ------------------------------------------------------------',
    `-- ${file}`,
    '-- ------------------------------------------------------------',
    '',
    sql.trimEnd(),
    '',
  );
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, parts.join('\n'), 'utf8');

console.log(`Bundled ${files.length} migrations → supabase/bundle.sql`);
for (const file of files) console.log(`  • ${file}`);
