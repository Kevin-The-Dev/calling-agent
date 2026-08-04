/**
 * Vercel Functions entry point.
 *
 * Vercel routes every request here (see vercel.json) and Hono handles the
 * routing internally. Uses the Web `fetch` handler signature, which is what the
 * Node runtime expects for a streaming-capable function — the turn endpoint
 * streams Server-Sent Events, so this must not be buffered.
 */
import { createApp } from '../src/app.js';

const app = createApp();

export default async function handler(request: Request): Promise<Response> {
  return app.fetch(request);
}
