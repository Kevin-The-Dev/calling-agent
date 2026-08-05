/**
 * Vercel Functions entry point.
 *
 * Two platform mismatches have to be bridged here, and each one failed in the
 * same silent way: the request connects, nothing is ever written back, and the
 * socket stays open until the platform times it out. In a browser that is
 * indistinguishable from a network error, so neither pointed at itself.
 *
 * ── 1. The handler signature ─────────────────────────────────────────────────
 * Vercel's Node runtime invokes a function as `(IncomingMessage, ServerResponse)`
 * and ignores the return value. An earlier version exported a Web-standard
 * `(Request) => Promise<Response>` handler, which type-checks, builds and
 * deploys — and then hangs every request, because Hono was handed an
 * `IncomingMessage` where it expected a `Request` and the `Response` it
 * produced went nowhere. `handle` bridges that, and pumps the response body out
 * incrementally, which the turn endpoint needs since it streams SSE.
 *
 * ── 2. The request body ──────────────────────────────────────────────────────
 * Fixing the signature left GET working and any POST that *reads its body*
 * still hanging. Vercel pre-parses the body onto `req.body` and drains the
 * underlying stream. The adapter looks for a pre-buffered body under
 * `req.rawBody`, does not find one, and falls back to `Readable.toWeb(incoming)`
 * — a stream that will never yield a byte and never end. `await c.req.json()`
 * then waits forever.
 *
 * So the body is restored under the name the adapter actually looks for. Both
 * cases are handled rather than assuming which applies: if the platform already
 * parsed it, it is re-serialized; if the stream is still intact, it is read.
 * That keeps this correct under `pnpm dev` and behind `vercel dev` as well as
 * in production, where the three behave differently.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '@hono/node-server/vercel';
import { createApp } from '../src/app.js';

const app = createApp();
const honoHandler = handle(app);

/** What Vercel adds to the incoming message. `body` is absent off-platform. */
type VercelIncoming = IncomingMessage & { body?: unknown; rawBody?: Buffer };

/** Methods that never carry a body, so never need one restored. */
const BODILESS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The request body as bytes, however the platform chose to hand it over.
 *
 * Returns undefined when there is genuinely no body — distinct from an empty
 * one, which must still be passed through so the route sees a real (invalid)
 * payload and answers 400 rather than stalling.
 */
async function readBody(req: VercelIncoming): Promise<Buffer | undefined> {
  const parsed = req.body;

  if (parsed !== undefined && parsed !== null) {
    if (Buffer.isBuffer(parsed)) return parsed;
    if (typeof parsed === 'string') return Buffer.from(parsed);

    // An object means the platform parsed it. Re-serialize in the shape the
    // Content-Type promises, since the route will parse it again by that same
    // header — handing JSON to a form parser would fail as confusingly as the
    // hang this replaces.
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('x-www-form-urlencoded')) {
      return Buffer.from(new URLSearchParams(parsed as Record<string, string>).toString());
    }
    return Buffer.from(JSON.stringify(parsed));
  }

  // Nothing parsed. Only now is reading the stream considered — and only when
  // the headers promise there is something in it. A request declaring no body
  // must never be read from: that is precisely the case that hangs, since a
  // stream with nothing to deliver may also never signal that it has ended.
  const declared = Number(req.headers['content-length'] ?? '0');
  const chunked = req.headers['transfer-encoding']?.includes('chunked') ?? false;
  if (!chunked && !(declared > 0)) return undefined;

  // The largest body this service accepts is a call recording, already capped
  // at 25MB by the route that receives it.
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }

  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
}

export default async function handler(
  req: VercelIncoming,
  res: ServerResponse,
): Promise<void> {
  if (!BODILESS.has(req.method ?? 'GET') && req.rawBody === undefined) {
    const body = await readBody(req);
    // Always set it, even when empty: its mere presence is what steers the
    // adapter away from the stream it can no longer read.
    req.rawBody = body ?? Buffer.alloc(0);
  }

  return honoHandler(req, res);
}
