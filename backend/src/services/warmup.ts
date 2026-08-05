/**
 * Connection warm-up.
 *
 * Both downstream services are far away and both are on the critical path of
 * the first thing a prospect hears. Measured from here:
 *
 *   GLM (China-hosted)          cold 1450ms → warm 632ms to first token
 *   Supabase (ap-northeast-1)   cold  435ms → warm 170ms per round trip
 *
 * Nearly all of that gap is TLS setup, and it is paid by whoever happens to
 * make the first request. Making that request ourselves at boot means it is
 * never the prospect.
 *
 * Deliberately fire-and-forget: a warm-up is an optimization, and a failing one
 * must never stop the process from serving. Real failures surface on
 * `/api/ready`, which checks the same two services and reports properly.
 */
import type { Env } from '../lib/env.js';
import type { Logger } from '../lib/logger.js';
import type { LlmProvider } from './llm/index.js';
import { getServiceClient } from './supabase.js';

export function warmUp(env: Env, provider: LlmProvider, logger: Logger): void {
  const startedAt = Date.now();

  void Promise.allSettled([
    provider.ping(),
    getServiceClient(env).from('calls').select('id').limit(1),
  ]).then((results) => {
    const [llm, db] = results;
    logger.info('warmup_complete', {
      durationMs: Date.now() - startedAt,
      llm: llm?.status ?? 'unknown',
      supabase: db?.status ?? 'unknown',
    });
  });
}
