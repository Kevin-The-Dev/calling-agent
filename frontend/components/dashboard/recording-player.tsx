'use client';

/**
 * Recording playback.
 *
 * A custom transport rather than `<audio controls>`: the native player is a
 * different shape, weight, and colour in every browser, and it sits in the
 * middle of a page that is otherwise one consistent surface.
 *
 * The `src` is a signed URL minted server-side and it expires. When it does,
 * playback fails with a network error rather than a 403 the user can act on, so
 * the failure message says to reload rather than reporting something opaque.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
  PauseIcon,
  PlayIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react/dist/ssr';
import { formatDuration } from './primitives';
import { usePlayback } from './playback-context';

export interface RecordingPlayerProps {
  src: string;
  /** Duration from the database, used before metadata loads. */
  durationSeconds: number | null;
  sizeBytes: number | null;
  /** 'prospect' for browser TTS calls — see implementation.md R13. */
  channels: string;
  downloadName: string;
}

export function RecordingPlayer({
  src,
  durationSeconds,
  sizeBytes,
  channels,
  downloadName,
}: RecordingPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [failed, setFailed] = useState(false);

  // The transcript is the agent's channel — the audio only carries the
  // prospect — so the two are read together. Publishing the position lets the
  // transcript follow along and offer to move the audio in return.
  const playback = usePlayback();
  const publish = playback?.publish;
  const register = playback?.register;

  const seekTo = useCallback((positionMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const seconds = positionMs / 1000;
    audio.currentTime = seconds;
    setCurrent(seconds);
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        // Autoplay refused, or the signed URL expired. The position still moved,
        // which is most of what a click on a transcript turn was asking for.
      });
  }, []);

  useEffect(() => {
    register?.(seekTo);
  }, [register, seekTo]);

  useEffect(() => {
    publish?.(current * 1000, playing);
  }, [publish, current, playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrent(audio.currentTime);
    const onLoaded = () => {
      // A webm produced by MediaRecorder often reports Infinity until it has
      // been seeked; fall back to the duration the client measured and sent.
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onError = () => {
      setFailed(true);
      setPlaying(false);
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('durationchange', onLoaded);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('durationchange', onLoaded);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || failed) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => setFailed(true));
  };

  const seek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Number(event.target.value);
    audio.currentTime = next;
    setCurrent(next);
  };

  const restart = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrent(0);
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  if (failed) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2.5 rounded-xl border border-alert/25 bg-alert-wash px-4 py-3 text-[13px] leading-relaxed text-alert"
      >
        <WarningCircleIcon className="mt-px size-4 shrink-0" />
        <span>
          This recording could not be played. Either the playback link has expired, in which case
          reloading the page mints a new one, or the audio itself is unreadable, which happens when a call is
          cut off before the recorder finishes writing the file.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-sunk/60 p-4">
      <audio ref={audioRef} src={src} preload="metadata" />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause recording' : 'Play recording'}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-paper transition-colors hover:bg-accent-deep"
        >
          {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="ml-0.5 size-4" />}
        </button>

        <div className="min-w-0 flex-1">
          {/* The range input is the real control; the bar behind it is the
              visible track, since a styled range is inconsistent across
              browsers and this must look identical everywhere. */}
          <div className="relative h-1.5">
            <div className="absolute inset-0 rounded-full bg-line" />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={current}
              onChange={seek}
              aria-label="Seek within the recording"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[11.5px] text-ink-3">
            <span className="tnum">{formatDuration(current)}</span>
            <span className="tnum">{formatDuration(duration)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={restart}
          aria-label="Restart recording"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
        >
          <ArrowCounterClockwiseIcon className="size-3.5" />
        </button>

        <a
          href={src}
          download={downloadName}
          aria-label="Download recording"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
        >
          <DownloadSimpleIcon className="size-3.5" />
        </a>
      </div>

      <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink-3">
        {channels === 'prospect'
          ? 'Prospect audio only. The assistant speaks through browser synthesis, which cannot be captured. Play this and the transcript below follows along, so you can read the assistant’s half where the audio falls silent.'
          : `${channels} audio`}
        {sizeBytes ? ` · ${(sizeBytes / 1_000_000).toFixed(1)} MB` : ''}
      </p>
    </div>
  );
}
