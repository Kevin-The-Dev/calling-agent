'use client';

import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; service: string; version: string }
  | { kind: 'error'; message: string };

/**
 * Live backend connectivity check.
 *
 * Exists so a broken `NEXT_PUBLIC_API_BASE_URL` or a stopped backend is obvious
 * before someone presses the call button, rather than surfacing as a
 * conversation that never starts.
 */
export function SystemStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    api
      .health()
      .then((health) => {
        if (cancelled) return;
        setState({ kind: 'ok', service: health.service, version: health.version });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message:
            err instanceof ApiError
              ? err.message
              : 'Could not reach the call service. Is the backend running?',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const tone =
    state.kind === 'ok'
      ? { fg: 'var(--color-live)', bg: 'var(--color-live-wash)', line: 'var(--color-live)' }
      : state.kind === 'error'
        ? { fg: 'var(--color-alert)', bg: 'var(--color-alert-wash)', line: 'var(--color-alert)' }
        : { fg: 'var(--color-ink-3)', bg: 'var(--color-sunk)', line: 'var(--color-line-strong)' };

  return (
    <div
      className="inline-flex items-center gap-2.5 rounded-full border px-3.5 py-2 text-[12.5px] font-medium"
      style={{ color: tone.fg, background: tone.bg, borderColor: `${tone.line}40` }}
      aria-live="polite"
      aria-busy={state.kind === 'loading'}
    >
      {state.kind === 'loading' && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
      {state.kind === 'ok' && <CircleCheck className="size-3.5 shrink-0" />}
      {state.kind === 'error' && <CircleAlert className="size-3.5 shrink-0" />}

      <span>
        {state.kind === 'loading' && 'Checking the call service…'}
        {state.kind === 'ok' && `Call service ready · v${state.version}`}
        {state.kind === 'error' && state.message}
      </span>
    </div>
  );
}
