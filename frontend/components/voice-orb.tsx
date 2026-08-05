'use client';

/**
 * The voice orb.
 *
 * A radial waveform around a solid core. While the prospect is talking every
 * bar is driven by the actual microphone amplitude, so the thing that moves on
 * screen is the thing the agent is hearing — if the mic dies, the orb goes
 * flat, which is exactly when the user needs to be told.
 *
 * While the *agent* is talking there is nothing to measure: the reply is played
 * through `speechSynthesis`, which browsers do not expose to Web Audio
 * (implementation.md R13). Those bars run on a smooth synthetic envelope and
 * are honest about being an activity indicator rather than a meter.
 *
 * Bars are written directly through refs inside one animation frame. Driving 44
 * of them through React state at 60fps would re-render the transcript beside
 * them sixty times a second to move some pixels.
 */
import { useEffect, useRef } from 'react';
import type { CallPhase } from '@/hooks/use-call';

const BARS = 44;
const RADIUS = 62;
const BAR_WIDTH = 2.5;
const BAR_MIN = 4;
const BAR_MAX = 30;
const SIZE = 220;
const CENTER = SIZE / 2;

/** Per-phase accent, matching the status pill beside it. */
const PHASE_COLOR: Record<CallPhase, string> = {
  idle: 'var(--color-ink-4)',
  connecting: 'var(--color-think)',
  listening: 'var(--color-live)',
  thinking: 'var(--color-think)',
  speaking: 'var(--color-accent)',
  ended: 'var(--color-ink-4)',
};

export interface VoiceOrbProps {
  phase: CallPhase;
  /** Reads the live microphone level, 0..1. Polled per frame, never rendered. */
  readLevel: () => number;
}

export function VoiceOrb({ phase, readLevel }: VoiceOrbProps) {
  const barsRef = useRef<(SVGRectElement | null)[]>([]);
  const coreRef = useRef<SVGCircleElement>(null);

  // Read the phase from a ref inside the loop so a phase change does not tear
  // down and restart the animation frame.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    // Respect the same preference the stylesheet does — a constantly moving
    // element is exactly what this setting exists to stop.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let synthetic = 0;

    const render = (time: number) => {
      const current = phaseRef.current;
      const live = current === 'listening';
      const talking = current === 'speaking';
      const idle = !live && !talking;

      let amplitude: number;
      if (live) {
        amplitude = readLevel();
      } else if (talking) {
        // Two detuned sines sum into a wandering envelope that never settles
        // into a visible loop the way a single sine does.
        const target =
          0.42 + 0.3 * Math.sin(time / 260) * Math.sin(time / 97) + 0.12 * Math.sin(time / 41);
        synthetic += (target - synthetic) * 0.14;
        amplitude = Math.max(0.12, synthetic);
      } else {
        synthetic += (0 - synthetic) * 0.08;
        amplitude = synthetic * 0.3;
      }

      for (let i = 0; i < BARS; i += 1) {
        const bar = barsRef.current[i];
        if (!bar) continue;

        // Offsetting each bar in time is what turns a pulsing ring into
        // something that reads as a waveform travelling around the circle.
        const wobble = 0.55 + 0.45 * Math.sin(time / 180 + i * 0.55);
        const height = BAR_MIN + amplitude * wobble * (BAR_MAX - BAR_MIN);

        bar.setAttribute('height', height.toFixed(2));
        bar.setAttribute('y', (CENTER - RADIUS - height).toFixed(2));
      }

      if (coreRef.current) {
        const scale = idle ? 1 : 1 + amplitude * 0.09;
        coreRef.current.setAttribute('r', (34 * scale).toFixed(2));
      }

      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [readLevel]);

  const color = PHASE_COLOR[phase];
  const active = phase === 'listening' || phase === 'speaking' || phase === 'thinking';

  return (
    <div className="relative grid place-items-center" aria-hidden="true">
      {/* Warm bloom behind the orb, brightening only while the call is live. */}
      <div
        className="pointer-events-none absolute size-52 rounded-full blur-3xl transition-opacity duration-700"
        style={{ background: color, opacity: active ? 0.16 : 0.05 }}
      />

      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="relative"
        role="presentation"
      >
        <defs>
          <radialGradient id="orb-core" cx="38%" cy="32%">
            <stop offset="0%" stopColor="var(--color-surface)" stopOpacity="0.95" />
            <stop offset="55%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.1" />
          </radialGradient>
        </defs>

        {/* Track the bars sit on, so the ring reads as a ring when silent. */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS + 2}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="1"
          strokeDasharray="2 5"
        />

        {Array.from({ length: BARS }, (_, i) => (
          <rect
            key={i}
            ref={(node) => {
              barsRef.current[i] = node;
            }}
            x={CENTER - BAR_WIDTH / 2}
            y={CENTER - RADIUS - BAR_MIN}
            width={BAR_WIDTH}
            height={BAR_MIN}
            rx={BAR_WIDTH / 2}
            fill={color}
            opacity={active ? 0.85 : 0.28}
            transform={`rotate(${(360 / BARS) * i} ${CENTER} ${CENTER})`}
            style={{ transition: 'fill 400ms ease, opacity 400ms ease' }}
          />
        ))}

        <circle cx={CENTER} cy={CENTER} r={34} fill="url(#orb-core)" />
        <circle
          ref={coreRef}
          cx={CENTER}
          cy={CENTER}
          r={34}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          opacity={active ? 0.5 : 0.25}
          style={{ transition: 'stroke 400ms ease, opacity 400ms ease' }}
        />
      </svg>
    </div>
  );
}
