'use client';

/**
 * The call console.
 *
 * The centrepiece of the page and the only interactive thing on it. Everything
 * here is real: the orb moves on live microphone amplitude, the transcript is
 * the actual conversation, and the stage rail reflects the server's state
 * machine rather than a scripted animation.
 *
 * Consent is a gate, not a checkbox to ignore: the call cannot start until it
 * is given (implementation.md R1), and the disclosure states plainly that the
 * caller is an AI and that the conversation is recorded.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CalendarCheckIcon,
  MicrophoneIcon,
  PhoneCallIcon,
  PhoneXIcon,
  ShieldCheckIcon,
  SparkleIcon,
  WarningIcon,
} from '@phosphor-icons/react/dist/ssr';
import { useCall, type CallPhase } from '@/hooks/use-call';
import { getPublicEnv } from '@/lib/env';
import { VoiceOrb } from '@/components/voice-orb';

const PHASE_LABEL: Record<CallPhase, string> = {
  idle: 'Ready when you are',
  connecting: 'Connecting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  ended: 'Call ended',
};

/** Token names, so the pill, the orb, and the dot never drift apart. */
const PHASE_TONE: Record<CallPhase, { fg: string; bg: string; line: string }> = {
  idle: { fg: 'var(--color-ink-3)', bg: 'var(--color-sunk)', line: 'var(--color-line)' },
  connecting: {
    fg: 'var(--color-think)',
    bg: 'var(--color-think-wash)',
    line: 'var(--color-think)',
  },
  listening: { fg: 'var(--color-live)', bg: 'var(--color-live-wash)', line: 'var(--color-live)' },
  thinking: { fg: 'var(--color-think)', bg: 'var(--color-think-wash)', line: 'var(--color-think)' },
  speaking: { fg: 'var(--color-accent-deep)', bg: 'var(--color-accent-wash)', line: 'var(--color-accent)' },
  ended: { fg: 'var(--color-ink-3)', bg: 'var(--color-sunk)', line: 'var(--color-line)' },
};

/**
 * The stages the server actually walks (backend/src/agents/state-machine.ts).
 * `objection_handling` is deliberately absent — it is a detour off whichever
 * stage is current, not a step along the rail.
 */
const STAGE_RAIL = [
  { id: 'opening', label: 'Opening' },
  { id: 'rapport', label: 'Reason' },
  { id: 'qualification', label: 'Qualifying' },
  { id: 'need_discovery', label: 'Discovery' },
  { id: 'value_pitch', label: 'Value' },
  { id: 'appointment', label: 'Booking' },
  { id: 'confirmation', label: 'Confirm' },
  { id: 'closing', label: 'Recap' },
] as const;

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CallConsole() {
  const call = useCall();
  const [consented, setConsented] = useState(false);
  const { showTranscript, requireConsent } = getPublicEnv();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [call.transcript, call.interim]);

  const active = call.phase !== 'idle' && call.phase !== 'ended';
  const canStart = (!requireConsent || consented) && call.supported;
  const tone = PHASE_TONE[call.phase];
  const empty = call.transcript.length === 0 && !call.interim;

  // -1 until the server reports a stage, so nothing lights up before the call.
  const stageIndex = STAGE_RAIL.findIndex((s) => s.id === call.stage);
  const booked = call.outcome === 'booked';

  return (
    <section
      id="console"
      aria-label="Voice call"
      className="relative scroll-mt-24 overflow-hidden rounded-console border border-line bg-surface shadow-console"
    >
      {/* ── Console header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 sm:px-6">
        <span
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors duration-500"
          style={{ color: tone.fg, background: tone.bg, borderColor: tone.line }}
        >
          <span className="relative grid size-2 place-items-center">
            <span
              className="absolute size-2 rounded-full"
              style={{ background: tone.line }}
            />
            {active && (
              <span
                className="absolute size-2 rounded-full animate-halo"
                style={{ background: tone.line }}
              />
            )}
          </span>
          <span aria-live="polite">{PHASE_LABEL[call.phase]}</span>
        </span>

        <span className="inline-flex items-center gap-3 text-[13px] text-ink-3">
          {active || call.phase === 'ended' ? (
            <span className="tnum">{formatElapsed(call.elapsed)}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheckIcon className="size-3.5" />
              Encrypted
            </span>
          )}
        </span>
      </div>

      {/* ── Orb ────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden px-5 pb-2 pt-7 sm:px-6">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-[0.5] texture-rule"
          style={{
            maskImage: 'radial-gradient(120% 90% at 50% 0%, #000, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(120% 90% at 50% 0%, #000, transparent 70%)',
          }}
        />

        <div className="relative grid place-items-center">
          <VoiceOrb phase={call.phase} readLevel={call.readLevel} />

          {/* Sits in the orb's core — the one place the eye is already looking. */}
          <div className="pointer-events-none absolute grid place-items-center text-center">
            {call.phase === 'thinking' ? (
              <span className="relative block h-1 w-10 overflow-hidden rounded-full bg-think/20">
                <span className="absolute inset-y-0 w-1/3 rounded-full bg-think animate-sweep" />
              </span>
            ) : call.phase === 'speaking' ? (
              <SparkleIcon className="size-6 text-accent" />
            ) : call.phase === 'listening' ? (
              <MicrophoneIcon className="size-6 text-live" />
            ) : booked ? (
              <CalendarCheckIcon className="size-6 text-booked" />
            ) : (
              <PhoneCallIcon className="size-6 text-ink-4" />
            )}
          </div>
        </div>
      </div>

      {/* ── Stage rail ─────────────────────────────────────────────────── */}
      <div className="px-5 pb-4 sm:px-6">
        <ol className="flex items-center gap-1" aria-label="Conversation progress">
          {STAGE_RAIL.map((stage, i) => {
            const reached = stageIndex >= 0 && i <= stageIndex;
            const current = i === stageIndex;
            return (
              <li key={stage.id} className="group relative flex-1">
                <span
                  className="block h-1 rounded-full transition-colors duration-500"
                  style={{
                    background: current
                      ? 'var(--color-accent)'
                      : reached
                        ? 'var(--color-accent-line)'
                        : 'var(--color-line)',
                  }}
                />
                <span className="sr-only">
                  {stage.label}
                  {current ? ' (current)' : ''}
                </span>
                {/* Labelling all eight would crowd the console; the current one
                    is the only one anyone needs. */}
                {current && (
                  <span className="absolute left-0 top-2.5 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em] text-accent-deep animate-fade">
                    {stage.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <div className="h-4" />
      </div>

      {/* ── Transcript ─────────────────────────────────────────────────── */}
      {showTranscript && (
        <div className="border-t border-line bg-sunk/60 px-5 py-4 sm:px-6">
          <div
            ref={scrollRef}
            // Grows into the space only once there is something to put in it.
            // Reserving the full height up front leaves a large empty panel
            // under the button on a page whose job is to get that button pressed.
            className={`scroll-slim mask-fade-top space-y-3 overflow-y-auto pr-1 transition-[height] duration-500 ${
              empty ? 'h-12' : 'h-56'
            }`}
            aria-label="Conversation transcript"
          >
            {empty ? (
              <p className="pt-3 text-center text-[13px] text-ink-3">
                The transcript appears here as you talk.
              </p>
            ) : (
              <>
                {call.transcript.map((entry) => (
                  <Bubble key={entry.id} speaker={entry.speaker} text={entry.text} />
                ))}
                {call.interim && <Bubble speaker="prospect" text={call.interim} interim />}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Alerts ─────────────────────────────────────────────────────── */}
      {(!call.supported || call.error) && (
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-alert/25 bg-alert-wash px-3.5 py-3 text-[13px] leading-relaxed text-alert"
          >
            <WarningIcon className="mt-px size-4 shrink-0" />
            <span>{call.supportReason ?? call.error}</span>
          </div>
        </div>
      )}

      {/* ── Consent + controls ─────────────────────────────────────────── */}
      <div className="space-y-4 border-t border-line px-5 py-5 sm:px-6">
        {requireConsent && !active && call.phase !== 'ended' && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-sunk/70 px-3.5 py-3 text-[13px] leading-relaxed text-ink-2 transition-colors hover:border-line-strong">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span>
              I understand I&apos;ll be speaking with an <strong className="font-semibold text-ink">AI assistant</strong>,
              that this conversation is <strong className="font-semibold text-ink">recorded and transcribed</strong>,
              and that my details will be used to arrange a consultation.
            </span>
          </label>
        )}

        {!active && call.phase !== 'ended' && (
          <button
            type="button"
            onClick={() => void call.start()}
            disabled={!canStart}
            className="press group flex w-full items-center justify-center gap-2.5 rounded-full bg-ink px-8 py-4 text-[15px] font-semibold text-paper shadow-lift hover:bg-accent-deep disabled:cursor-not-allowed disabled:border disabled:border-line-strong disabled:bg-sunk disabled:text-ink-3 disabled:shadow-none"
          >
            <PhoneCallIcon className="size-4.5 transition-transform duration-300 group-enabled:group-hover:-rotate-12" />
            Start the call
          </button>
        )}

        {active && (
          <button
            type="button"
            onClick={() => void call.end()}
            className="press flex w-full items-center justify-center gap-2.5 rounded-full border border-alert/30 bg-alert-wash px-8 py-4 text-[15px] font-semibold text-alert hover:bg-alert hover:text-paper"
          >
            <PhoneXIcon className="size-4.5" />
            End call
          </button>
        )}

        {call.phase === 'ended' && (
          <div className="space-y-4 text-center">
            <div
              className="mx-auto flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium"
              style={{
                background: booked ? 'var(--color-booked-wash)' : 'var(--color-sunk)',
                color: booked ? 'var(--color-booked)' : 'var(--color-ink-2)',
              }}
            >
              {booked ? <CalendarCheckIcon className="size-4" /> : <PhoneXIcon className="size-4" />}
              {booked ? "You're booked in. We'll text the confirmation." : 'Thanks for your time.'}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-[13px] font-medium text-ink-3 underline underline-offset-4 transition-colors hover:text-accent-deep"
            >
              Start another call
            </button>
          </div>
        )}

        <p className="text-center text-[12px] leading-relaxed text-ink-3">
          Needs a microphone. Chrome, Edge, or Safari.
        </p>
      </div>
    </section>
  );
}

function Bubble({
  speaker,
  text,
  interim = false,
}: {
  speaker: 'agent' | 'prospect';
  text: string;
  interim?: boolean;
}) {
  const isAgent = speaker === 'agent';

  return (
    <div className={`flex animate-fade ${isAgent ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[85%]">
        <p
          className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3 ${
            isAgent ? 'text-left' : 'text-right'
          }`}
        >
          {isAgent ? 'Assistant' : 'You'}
        </p>
        <p
          className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
            isAgent
              ? 'rounded-tl-sm border border-line bg-surface text-ink'
              : 'rounded-tr-sm bg-ink text-paper'
          } ${interim ? 'opacity-55 italic' : ''}`}
        >
          {text}
        </p>
      </div>
    </div>
  );
}
