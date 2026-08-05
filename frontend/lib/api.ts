/**
 * Typed client for the Hono backend.
 *
 * The only place the frontend knows the backend's URL shape. Errors come back
 * in the single `{ error: { code, message } }` envelope the backend guarantees
 * (see backend/src/lib/errors.ts).
 */
import { getPublicEnv } from './env';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * The request never reached the backend at all.
 *
 * Distinct from `ApiError`, which means the backend answered and said no. This
 * one is DNS, TLS, a refused connection, or CORS — and the browser deliberately
 * tells us nothing about which, to avoid leaking cross-origin information. All
 * four arrive as the same bare `TypeError: Failed to fetch`.
 *
 * That message on its own is unactionable, which is the entire reason this
 * class exists: it carries the URL that was attempted, so the failure names the
 * thing that has to be fixed.
 */
export class ApiUnreachableError extends Error {
  readonly url: string;

  constructor(url: string, message: string) {
    super(message);
    this.name = 'ApiUnreachableError';
    this.url = url;
  }
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

/** The absolute URL a given API path resolves to. */
export function apiUrl(path: string): string {
  return `${getPublicEnv().apiBaseUrl}${path}`;
}

/**
 * Why the request could not be made, in terms of what to change.
 *
 * `NEXT_PUBLIC_*` values are inlined into the JavaScript bundle at build time,
 * not read at runtime. So a deployed page built without the variable set keeps
 * whatever `.env.local` had — `http://localhost:8787` — and every visitor's
 * browser dutifully tries to reach a server on *their own machine*. It fails
 * identically to a backend being down, which makes it very easy to spend an
 * hour debugging the wrong end. Worth detecting explicitly.
 */
function diagnoseUnreachable(url: string): string {
  const page = typeof window === 'undefined' ? null : window.location.hostname;
  const target = new URL(url).hostname;
  const isLoopback = (host: string) =>
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

  if (page && !isLoopback(page) && isLoopback(target)) {
    return (
      `This page is deployed at ${page} but was built to call the backend at ${target}. ` +
      'Set NEXT_PUBLIC_API_BASE_URL to the deployed backend URL and rebuild — it is ' +
      'baked into the bundle at build time, so changing it needs a new deployment.'
    );
  }

  return `Could not reach the call service at ${url}. It may be down, or it may be refusing this origin.`;
}

/**
 * A fetch that fails legibly. Returns the raw `Response` — the caller decides
 * what a non-OK status means, since the streaming turn endpoint and the plain
 * JSON endpoints disagree about that.
 */
export async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(path);

  try {
    return await fetch(url, init);
  } catch (err) {
    // An aborted request is the caller hanging up or barging in, not a failure
    // to reach anything. It has to pass through untouched so the abort handling
    // upstream still recognises it.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiUnreachableError(url, diagnoseUnreachable(url));
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchApi(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error.code ?? 'unknown',
      body?.error.message ?? `Request failed with status ${response.status}`,
    );
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
};
