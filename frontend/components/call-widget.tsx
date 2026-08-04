'use client';

import { useEffect, useRef, useState } from 'react';
import { useCall } from '@/hooks/use-call';
import { getPublicEnv } from '@/lib/env';

const PHASE_LABEL: Record<string, string> = {
  idle: 'Ready',
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  ended: 'Call ended',
};

/**
 * The call widget.
 *
 * Consent is a gate, not a checkbox to ignore: the call cannot start until it
 * is given (implementation.md R1), and the disclosure states plainly that the
 * caller is an AI and that the conversation is recorded.
 */
export function CallWidget() {
  const call = useCall();
  const [consented, setConsented] = useState(false);
  const { showTranscript, requireConsent } = getPublicEnv();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [call.transcript, call.interim]);

  const active = call.phase !== 'idle' && call.phase !== 'ended';
  const canStart = (!requireConsent || consented) && call.supported;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Talk to us about your electricity bill</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          A short conversation to see whether your home qualifies for a savings consultation.
        </p>
      </header>

      {!call.supported && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--color-bad)] bg-[color-mix(in_srgb,var(--color-bad)_8%,transparent)] p-4 text-sm"
        >
          {call.supportReason}
        </div>
      )}

      {call.error && (
        <div role="alert" className="rounded-lg border border-[var(--color-bad)] p-4 text-sm">
          {call.error}
        </div>
      )}

      {/* Status */}
      <div className="flex items-center justify-center gap-3 rounded-xl border border-[var(--color-line)] px-4 py-6">
        <span
          aria-hidden="true"
          className={`inline-block h-3 w-3 rounded-full ${active ? 'animate-pulse' : ''}`}
          style={{
            background:
              call.phase === 'listening'
                ? 'var(--color-ok)'
                : call.phase === 'speaking'
                  ? 'var(--color-accent)'
                  : call.phase === 'thinking'
                    ? 'var(--color-warn)'
                    : 'var(--color-ink-soft)',
          }}
        />
        <span className="text-sm font-medium" aria-live="polite">
          {PHASE_LABEL[call.phase] ?? call.phase}
        </span>
      </div>

      {/* Transcript */}
      {showTranscript && (call.transcript.length > 0 || call.interim) && (
        <div
          ref={scrollRef}
          className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-[var(--color-line)] p-4"
          aria-label="Conversation transcript"
        >
          {call.transcript.map((entry) => (
            <div
              key={entry.id}
              className={entry.speaker === 'agent' ? 'text-left' : 'text-right'}
            >
              <p className="mb-1 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                {entry.speaker === 'agent' ? 'Assistant' : 'You'}
              </p>
              <p className="text-sm leading-relaxed">{entry.text}</p>
            </div>
          ))}
          {call.interim && (
            <div className="text-right opacity-50">
              <p className="text-sm italic leading-relaxed">{call.interim}</p>
            </div>
          )}
        </div>
      )}

      {/* Consent gate */}
      {requireConsent && !active && call.phase !== 'ended' && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-line)] p-4 text-sm">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I understand I&apos;ll be speaking with an <strong>AI assistant</strong>, that this
            conversation is <strong>recorded and transcribed</strong>, and that my details will be
            used to arrange a consultation.
          </span>
        </label>
      )}

      {/* Controls */}
      <div className="flex justify-center gap-3">
        {!active && call.phase !== 'ended' && (
          <button
            type="button"
            onClick={() => void call.start()}
            disabled={!canStart}
            className="rounded-full bg-[var(--color-ink)] px-8 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Start the call
          </button>
        )}

        {active && (
          <button
            type="button"
            onClick={() => void call.end()}
            className="rounded-full border border-[var(--color-bad)] px-8 py-3 text-sm font-medium text-[var(--color-bad)]"
          >
            End call
          </button>
        )}

        {call.phase === 'ended' && (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Thanks for your time
            {call.outcome === 'booked' ? " — you're all set." : '.'}
          </p>
        )}
      </div>

      <p className="text-center text-xs text-[var(--color-ink-soft)]">
        Microphone required. Works in Chrome, Edge, and Safari.
      </p>
    </div>
  );
}
