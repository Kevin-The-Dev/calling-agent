/**
 * Typed application errors.
 *
 * Every error that reaches a client is deliberately shaped: a stable `code`, a
 * safe `message`, and nothing else. Internal detail (provider responses, stack
 * traces, prompts) stays server-side — claude.md §11 forbids leaking internals,
 * and §5 forbids the agent revealing its own machinery.
 */

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'llm_error'
  | 'llm_timeout'
  | 'storage_error'
  | 'database_error'
  | 'internal_error';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  llm_error: 502,
  llm_timeout: 504,
  storage_error: 502,
  database_error: 500,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Server-side only. Never serialized to a client. */
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.detail = detail;
  }

  /** The only shape that ever crosses the wire. */
  toResponseBody(): { error: { code: ErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

export const badRequest = (message: string, detail?: Record<string, unknown>) =>
  new AppError('bad_request', message, detail);
export const unauthorized = (message = 'Unauthorized') => new AppError('unauthorized', message);
export const forbidden = (message = 'Forbidden') => new AppError('forbidden', message);
export const notFound = (message = 'Not found') => new AppError('not_found', message);
export const rateLimited = (message = 'Too many requests') => new AppError('rate_limited', message);
export const llmError = (message: string, detail?: Record<string, unknown>) =>
  new AppError('llm_error', message, detail);
export const llmTimeout = (message = 'The model did not respond in time') =>
  new AppError('llm_timeout', message);
export const databaseError = (message: string, detail?: Record<string, unknown>) =>
  new AppError('database_error', message, detail);

/**
 * Normalizes anything thrown into an AppError.
 * Unknown throwables become a generic internal error so that an accidental
 * `throw someProviderResponse` can't leak upstream detail to a caller.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    return new AppError('internal_error', 'An unexpected error occurred', {
      originalName: err.name,
      originalMessage: err.message,
    });
  }
  return new AppError('internal_error', 'An unexpected error occurred', { thrown: String(err) });
}
