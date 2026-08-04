/**
 * Local development server.
 *
 * On Vercel the app is served by `api/index.ts` instead; this entry point is
 * for `pnpm dev`. Env is validated here so a misconfiguration is a startup
 * failure with a readable message, not a runtime surprise mid-call.
 */
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { describeEnv, getEnv } from './lib/env.js';

function main(): void {
  let env;
  try {
    env = getEnv();
  } catch (err) {
    console.error('\n✗ Startup failed.\n');
    console.error(err instanceof Error ? err.message : String(err));
    console.error('');
    process.exit(1);
  }

  const app = createApp(env);

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`\n✓ backend listening on http://localhost:${info.port}`);
    console.log(`  health : http://localhost:${info.port}/api/health`);
    console.log(`  ready  : http://localhost:${info.port}/api/ready\n`);
    console.table(describeEnv(env));
  });
}

main();
