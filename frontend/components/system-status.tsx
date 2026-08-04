'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; service: string; version: string }
  | { kind: 'error'; message: string };

/**
 * Live backend connectivity check.
 *
 * Exists so a broken `NEXT_PUBLIC_API_BASE_URL` or a stopped backend is
 * obvious immediately, rather than surfacing as a confusing failure mid-call
 * once the voice layer lands.
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
              : 'Could not reach the backend. Is it running on port 8787?',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      className="rounded-xl border border-[var(--color-line)] p-5"
      aria-live="polite"
      aria-busy={state.kind === 'loading'}
    >
      <h2 className="mb-3 text-sm font-semibold">System status</h2>

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{
            background:
              state.kind === 'ok'
                ? 'var(--color-ok)'
                : state.kind === 'error'
                  ? 'var(--color-bad)'
                  : 'var(--color-ink-soft)',
          }}
        />
        <p className="text-sm">
          {state.kind === 'loading' && 'Checking backend…'}
          {state.kind === 'ok' && `Backend connected — ${state.service} v${state.version}`}
          {state.kind === 'error' && state.message}
        </p>
      </div>
    </section>
  );
}
