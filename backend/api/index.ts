/**
 * Vercel Functions entry point.
 *
 * Vercel routes every request here (see vercel.json) and Hono handles the
 * routing internally.
 *
 * The adapter is not optional. Vercel's Node runtime invokes a function with
 * the Node signature — `(IncomingMessage, ServerResponse)` — and ignores
 * whatever the function returns. An earlier version of this file exported a
 * Web-standard `(Request) => Promise<Response>` handler, which type-checks,
 * builds, deploys, and then hangs every single request: Hono was handed an
 * `IncomingMessage` where it expected a `Request`, the `Response` it produced
 * went nowhere, and nothing ever wrote to or ended the real `ServerResponse`.
 * The connection stayed open with zero bytes sent until the platform timed it
 * out — which reads in the browser as an ordinary network failure, not as a
 * backend that is running and answering nothing.
 *
 * `handle` bridges the two: it builds the `Request` Hono expects, and pumps the
 * `Response` body back to the `ServerResponse` incrementally — which the turn
 * endpoint depends on, since it streams Server-Sent Events and must not be
 * buffered to completion before the prospect hears the first sentence.
 */
import { handle } from '@hono/node-server/vercel';
import { createApp } from '../src/app.js';

const app = createApp();

export default handle(app);
