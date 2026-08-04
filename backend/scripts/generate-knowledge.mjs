#!/usr/bin/env node
/**
 * Compiles docs/knowledge/*.md into a TypeScript module.
 *
 * Why generate instead of reading files at runtime:
 *
 *   1. Vercel deploys `backend/` as its own project root. Anything outside that
 *      directory — including `docs/` — is not in the bundle. A runtime
 *      `readFile('../docs/...')` works locally and 404s in production.
 *   2. Serverless functions should not touch the filesystem on a hot path.
 *   3. The generated module is the fallback when the `knowledge_documents`
 *      table is empty or unreachable, so the agent still has its script.
 *
 * The output is committed. Re-run after editing any knowledge document:
 *
 *   pnpm --filter backend knowledge:build
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, '..', '..', 'docs', 'knowledge');
const outputPath = join(here, '..', 'src', 'knowledge', 'generated', 'documents.ts');

/** Slug → human title. Order matters: it is the order used in prompt assembly. */
const TITLES = {
  'company-context': 'Company Context',
  'sales-script': 'Sales Script',
  'qualification-rules': 'Qualification Rules',
  'objection-handling': 'Objection Handling',
  'appointment-booking': 'Appointment Booking',
  'conversation-flow': 'Conversation Flow',
  'fallback-responses': 'Fallback Responses',
};

const files = (await readdir(sourceDir)).filter((f) => f.endsWith('.md')).sort();
const docs = [];

for (const file of files) {
  const slug = basename(file, '.md');
  if (!(slug in TITLES)) {
    console.warn(`skipping ${file} — not a known knowledge slug`);
    continue;
  }
  docs.push({ slug, title: TITLES[slug], content: await readFile(join(sourceDir, file), 'utf8') });
}

const missing = Object.keys(TITLES).filter((slug) => !docs.some((d) => d.slug === slug));
if (missing.length > 0) {
  console.error(`Missing knowledge documents: ${missing.join(', ')}`);
  process.exit(1);
}

// Order by the TITLES key order rather than alphabetically.
docs.sort((a, b) => Object.keys(TITLES).indexOf(a.slug) - Object.keys(TITLES).indexOf(b.slug));

const body = docs
  .map((d) => `  {\n    slug: '${d.slug}',\n    title: ${JSON.stringify(d.title)},\n    content: ${JSON.stringify(d.content)},\n  },`)
  .join('\n');

const out = `/* eslint-disable */
/**
 * GENERATED FILE — do not edit.
 *
 * Source: docs/knowledge/*.md
 * Rebuild: pnpm --filter backend knowledge:build
 *
 * These are the extracted contents of the two source PDFs and are the only
 * permitted source of product facts (claude.md §2, §8).
 */

export interface GeneratedKnowledgeDocument {
  slug: string;
  title: string;
  content: string;
}

export const KNOWLEDGE_SLUGS = [
${Object.keys(TITLES).map((s) => `  '${s}',`).join('\n')}
] as const;

export type KnowledgeSlug = (typeof KNOWLEDGE_SLUGS)[number];

export const GENERATED_KNOWLEDGE: GeneratedKnowledgeDocument[] = [
${body}
];
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, out, 'utf8');

const bytes = docs.reduce((n, d) => n + d.content.length, 0);
console.log(`Generated ${docs.length} knowledge documents (${(bytes / 1024).toFixed(1)} KB)`);
for (const d of docs) console.log(`  • ${d.slug.padEnd(22)} ${(d.content.length / 1024).toFixed(1)} KB`);
