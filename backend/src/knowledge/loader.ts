/**
 * Knowledge document loader.
 *
 * Source-of-truth order (implementation.md §1.3):
 *   1. `knowledge_documents` in Supabase — editable from the dashboard, so a
 *      prompt fix does not require a deploy.
 *   2. The generated module compiled from docs/knowledge/*.md — the fallback
 *      when the table is empty, unreachable, or still holds seed placeholders.
 *
 * Cached in-process with a short TTL: a serverless instance can serve many
 * turns, and re-fetching ~52KB of markdown per turn would be wasteful, but an
 * admin editing the script should see it take effect within a minute.
 */
import type { Env } from '../lib/env.js';
import { createLogger } from '../lib/logger.js';
import { getServiceClient } from '../services/supabase.js';
import {
  GENERATED_KNOWLEDGE,
  KNOWLEDGE_SLUGS,
  type KnowledgeSlug,
} from './generated/documents.js';

export interface KnowledgeDocument {
  slug: KnowledgeSlug;
  title: string;
  content: string;
  source: 'database' | 'bundled';
}

export type KnowledgeBase = Record<KnowledgeSlug, KnowledgeDocument>;

const CACHE_TTL_MS = 60_000;
/** Rows still holding the migration's placeholder body are not real content. */
const PLACEHOLDER = '<!-- pending seed -->';

let cache: { at: number; value: KnowledgeBase } | undefined;

function bundled(): KnowledgeBase {
  const base = {} as KnowledgeBase;
  for (const doc of GENERATED_KNOWLEDGE) {
    base[doc.slug as KnowledgeSlug] = {
      slug: doc.slug as KnowledgeSlug,
      title: doc.title,
      content: doc.content,
      source: 'bundled',
    };
  }
  return base;
}

/**
 * Loads the knowledge base, preferring database rows over bundled files.
 *
 * Never throws: if Supabase is down mid-call the agent must keep talking with
 * the bundled script rather than losing its knowledge entirely.
 */
export async function loadKnowledge(env: Env, force = false): Promise<KnowledgeBase> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const base = bundled();
  const logger = createLogger(env.LOG_LEVEL, { component: 'knowledge' });

  try {
    const { data, error } = await getServiceClient(env)
      .from('knowledge_documents')
      .select('slug, title, content, is_active')
      .eq('is_active', true);

    if (error) {
      logger.warn('knowledge_db_read_failed', { message: error.message });
    } else {
      for (const row of data ?? []) {
        const slug = row.slug as KnowledgeSlug;
        if (!KNOWLEDGE_SLUGS.includes(slug)) continue;

        const content = String(row.content ?? '').trim();
        if (content.length === 0 || content === PLACEHOLDER) continue;

        base[slug] = {
          slug,
          title: String(row.title ?? base[slug].title),
          content,
          source: 'database',
        };
      }
    }
  } catch (err) {
    logger.warn('knowledge_db_unreachable', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  cache = { at: Date.now(), value: base };
  return base;
}

/** Test/admin hook: drop the cache so the next load re-reads the database. */
export function invalidateKnowledgeCache(): void {
  cache = undefined;
}

/** Synchronous bundled-only access, for prompt-building tests and seeding. */
export function bundledKnowledge(): KnowledgeBase {
  return bundled();
}
