'use client';

/**
 * The transcript, synchronised to the recording.
 *
 * The recording holds the prospect's audio only — the agent speaks through
 * browser synthesis, which cannot be captured (implementation.md R13). So the
 * agent's half of the call exists solely here, and following the whole
 * conversation means reading this in step with the audio rather than listening
 * to it. Playing the recording walks the highlight down the transcript;
 * clicking a turn moves the audio to it.
 *
 * Turns without audio offsets — calls recorded before offsets were captured —
 * render as a plain transcript with no highlighting and no click targets, which
 * is exactly what they were before.
 */
import { useEffect, useMemo, useRef } from 'react';
import { humanize } from './primitives';
import { usePlayback } from './playback-context';

export interface TranscriptTurn {
  turn_index: number;
  speaker: string;
  content: string;
  stage: string;
  latency_ms: number | null;
  audio_start_ms: number | null;
  audio_end_ms: number | null;
}

export interface CallTranscriptProps {
  turns: TranscriptTurn[];
}

/** A turn resolved to the span of recording time it occupies. */
interface Positioned {
  turn: TranscriptTurn;
  /** Null when this turn has no place on the timeline. */
  startMs: number | null;
  endMs: number | null;
}

const formatOffset = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Gives every turn a span on the recording's timeline.
 *
 * Only the prospect's turns carry a real end — theirs is the only audio in the
 * file. An agent turn runs from where it starts until the next turn that has a
 * start of its own, which is the silence its synthesized speech filled.
 */
function position(turns: TranscriptTurn[]): Positioned[] {
  return turns.map((turn, i) => {
    const startMs = turn.audio_start_ms;
    if (startMs === null) return { turn, startMs: null, endMs: null };

    if (turn.audio_end_ms !== null) return { turn, startMs, endMs: turn.audio_end_ms };

    // Run to the next turn that is anchored in time. A trailing turn with
    // nothing after it stays open, so the highlight rests on the agent's
    // closing line rather than falling off the end.
    for (let j = i + 1; j < turns.length; j += 1) {
      const next = turns[j]?.audio_start_ms;
      if (next !== null && next !== undefined) return { turn, startMs, endMs: next };
    }
    return { turn, startMs, endMs: null };
  });
}

export function CallTranscript({ turns }: CallTranscriptProps) {
  const playback = usePlayback();
  const activeRef = useRef<HTMLDivElement>(null);

  const positioned = useMemo(() => position(turns), [turns]);
  const synced = playback?.available === true && positioned.some((p) => p.startMs !== null);

  const activeIndex = useMemo(() => {
    if (!synced || !playback) return -1;
    const at = playback.positionMs;
    return positioned.findIndex(
      (p) => p.startMs !== null && at >= p.startMs && (p.endMs === null || at < p.endMs),
    );
  }, [synced, playback, positioned]);

  // Keep the highlighted turn visible, but only while audio is actually
  // running. Scrolling the panel out from under someone who is reading it with
  // the player paused would be its own bug.
  const playing = playback?.playing ?? false;
  useEffect(() => {
    if (activeIndex < 0 || !playing) return;
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex, playing]);

  return (
    <div className="scroll-slim max-h-[36rem] space-y-4 overflow-y-auto p-5">
      {synced && (
        <p className="sticky top-0 z-10 -mx-5 -mt-5 mb-1 border-b border-line bg-surface/95 px-5 py-2 text-[11.5px] leading-relaxed text-ink-3 backdrop-blur">
          Following the recording. The assistant is silent in the audio, so its half of the call is
          here. Select any turn to jump the recording to it.
        </p>
      )}

      {positioned.map(({ turn, startMs }, i) => {
        const isAgent = turn.speaker === 'agent';
        const isActive = i === activeIndex;
        const seekable = synced && startMs !== null;

        const bubble = (
          <>
            <p
              className={`mb-1 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-3 ${
                isAgent ? 'justify-start' : 'justify-end'
              }`}
            >
              {isAgent ? 'Agent' : 'Prospect'}
              <span className="font-normal normal-case tracking-normal text-ink-4">
                {humanize(turn.stage)}
                {turn.latency_ms ? ` · ${turn.latency_ms}ms` : ''}
                {startMs !== null ? ` · ${formatOffset(startMs)}` : ''}
              </span>
            </p>
            <p
              className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                isAgent
                  ? 'rounded-tl-sm border border-line bg-surface text-ink'
                  : 'rounded-tr-sm bg-ink text-paper'
              } ${isActive ? 'ring-2 ring-accent ring-offset-2 ring-offset-paper' : ''}`}
            >
              {turn.content}
            </p>
          </>
        );

        return (
          <div
            key={turn.turn_index}
            ref={isActive ? activeRef : undefined}
            className={`flex ${isAgent ? 'justify-start' : 'justify-end'}`}
          >
            {seekable ? (
              <button
                type="button"
                onClick={() => playback?.seek(startMs)}
                aria-label={`Play from ${formatOffset(startMs)}`}
                aria-current={isActive ? 'true' : undefined}
                className="max-w-[85%] cursor-pointer rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {bubble}
              </button>
            ) : (
              <div className="max-w-[85%]">{bubble}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
