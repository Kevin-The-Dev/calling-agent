/**
 * Call tokens.
 *
 * The call widget is public — no login — so each conversation gets a signed,
 * expiring token scoped to one call id. Without this, anyone could POST turns
 * against someone else's call id and inject text into their transcript.
 *
 * HMAC-SHA256 over `callId.leadId.expiry`, using Node's WebCrypto so the same
 * code runs on Vercel's runtime without a Node-only dependency.
 */
import { unauthorized } from './errors.js';

export interface CallTokenPayload {
  callId: string;
  leadId: string;
  expiresAt: number;
}

const encoder = new TextEncoder();

/** WebCrypto's CryptoKey, derived rather than imported — the backend's lib does not include DOM. */
type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

async function hmacKey(secret: string): Promise<HmacKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function base64url(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString('base64url');
}

export async function signCallToken(
  secret: string,
  payload: CallTokenPayload,
): Promise<string> {
  const body = `${payload.callId}.${payload.leadId}.${payload.expiresAt}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${Buffer.from(body).toString('base64url')}.${base64url(signature)}`;
}

/**
 * Verifies a token and returns its payload.
 * Throws `unauthorized` on any tampering, malformation, or expiry.
 */
export async function verifyCallToken(secret: string, token: string): Promise<CallTokenPayload> {
  const parts = token.split('.');
  if (parts.length !== 2) throw unauthorized('Malformed call token');

  const [encodedBody, encodedSignature] = parts as [string, string];

  let body: string;
  try {
    body = Buffer.from(encodedBody, 'base64url').toString('utf8');
  } catch {
    throw unauthorized('Malformed call token');
  }

  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    Buffer.from(encodedSignature, 'base64url'),
    encoder.encode(body),
  );
  if (!valid) throw unauthorized('Invalid call token');

  const segments = body.split('.');
  if (segments.length !== 3) throw unauthorized('Malformed call token');

  const [callId, leadId, expiryRaw] = segments as [string, string, string];
  const expiresAt = Number(expiryRaw);

  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    throw unauthorized('Call token has expired');
  }

  return { callId, leadId, expiresAt };
}
