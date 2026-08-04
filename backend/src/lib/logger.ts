/**
 * Structured logging with PII redaction.
 *
 * Two rules this module exists to enforce (claude.md §11):
 *   1. API keys and tokens never reach the log stream.
 *   2. Prospect PII (phone, email, address) is masked by default — transcripts
 *      belong in Supabase behind RLS, not in a log aggregator.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are replaced wholesale. Matched case-insensitively. */
const SECRET_KEYS = [
  'apikey',
  'api_key',
  'authorization',
  'token',
  'secret',
  'password',
  'servicerole',
  'service_role',
  'anonkey',
  'anon_key',
  'jwt',
  'cookie',
];

/** Keys treated as PII: partially masked so they stay useful for debugging. */
const PII_KEYS = ['phone', 'email', 'address', 'callback_number', 'confirmation_phone'];

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z_]/g, '');
  return SECRET_KEYS.some((s) => k.includes(s));
}

function isPiiKey(key: string): boolean {
  const k = key.toLowerCase();
  return PII_KEYS.some((p) => k.includes(p));
}

/** Keeps the last 4 characters so a value can still be correlated. */
function maskPii(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (value.length <= 4) return '****';
  return `***${value.slice(-4)}`;
}

/**
 * Recursively redacts an object for logging.
 * Depth-limited so a cyclic or pathological payload can't hang the logger.
 */
export function redact(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth limit]';
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((item) => redact(item, depth + 1));

  if (typeof input === 'object') {
    if (input instanceof Error) {
      return { name: input.name, message: input.message };
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isSecretKey(key)) out[key] = '[redacted]';
      else if (isPiiKey(key)) out[key] = maskPii(value);
      else out[key] = redact(value, depth + 1);
    }
    return out;
  }

  return input;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function emit(
  minLevel: LogLevel,
  level: LogLevel,
  bindings: Record<string, unknown>,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(redact(bindings) as Record<string, unknown>),
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  // eslint-disable-next-line no-console
  else console.log(line);
}

export function createLogger(minLevel: LogLevel = 'info', bindings: Record<string, unknown> = {}) {
  const logger: Logger = {
    debug: (m, c) => emit(minLevel, 'debug', bindings, m, c),
    info: (m, c) => emit(minLevel, 'info', bindings, m, c),
    warn: (m, c) => emit(minLevel, 'warn', bindings, m, c),
    error: (m, c) => emit(minLevel, 'error', bindings, m, c),
    child: (extra) => createLogger(minLevel, { ...bindings, ...extra }),
  };
  return logger;
}
