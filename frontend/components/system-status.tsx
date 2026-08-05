'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircleIcon,
  CircleNotchIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react/dist/ssr';
import { api, ApiError, ApiUnreachableError } from '@/lib/api';

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
          // `ApiUnreachableError` already explains which URL failed and why,
          // which is the whole point of it — passing it through unchanged beats
          // the generic line this used to show for every possible failure.
          message:
            err instanceof ApiError || err instanceof ApiUnreachableError
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
      {state.kind === 'loading' && <CircleNotchIcon className="size-3.5 shrink-0 animate-spin" />}
      {state.kind === 'ok' && <CheckCircleIcon className="size-3.5 shrink-0" />}
      {state.kind === 'error' && <WarningCircleIcon className="size-3.5 shrink-0" />}

      <span>
        {state.kind === 'loading' && 'Checking the call service…'}
        {state.kind === 'ok' && `Call service ready · v${state.version}`}
        {state.kind === 'error' && state.message}
      </span>
    </div>
  );
}
