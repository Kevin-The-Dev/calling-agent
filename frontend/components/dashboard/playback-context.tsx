'use client';

/**
 * Shared playback position for one call.
 *
 * The recording player and the transcript sit in separate cards, some distance
 * apart in the page, and both are rendered inside a server component that
 * fetches the call. Rather than restructure the page around one client
 * component, they meet here: the player publishes where it is, the transcript
 * reads it and offers to move it.
 *
 * This exists because of decision D8. The agent speaks through browser
 * synthesis, which never reaches the microphone stream, so the audio file holds
 * the prospect's half of the conversation and nothing else. Following both
 * halves means reading the transcript in step with the audio — the transcript
 * is the agent's channel.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

interface PlaybackValue {
  /** Current position in seconds. 0 when nothing has played yet. */
  positionMs: number;
  /** True while audio is actually advancing. */
  playing: boolean;
  /** Whether a player registered at all — false means there is no recording. */
  available: boolean;
  publish(positionMs: number, playing: boolean): void;
  register(seek: (positionMs: number) => void): void;
  seek(positionMs: number): void;
}

const PlaybackContext = createContext<PlaybackValue | null>(null);

export function PlaybackProvider({ children }: { children: React.ReactNode }) {
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [available, setAvailable] = useState(false);
  const seekRef = useRef<((positionMs: number) => void) | null>(null);

  const publish = useCallback((next: number, isPlaying: boolean) => {
    setPositionMs(next);
    setPlaying(isPlaying);
  }, []);

  const register = useCallback((seek: (positionMs: number) => void) => {
    seekRef.current = seek;
    setAvailable(true);
  }, []);

  const seek = useCallback((next: number) => {
    seekRef.current?.(next);
  }, []);

  const value = useMemo<PlaybackValue>(
    () => ({ positionMs, playing, available, publish, register, seek }),
    [positionMs, playing, available, publish, register, seek],
  );

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

/**
 * Returns null outside a provider.
 *
 * Both consumers are useful on their own — the transcript still reads perfectly
 * well on a call with no recording — so neither should throw for want of a
 * provider it does not strictly need.
 */
export function usePlayback(): PlaybackValue | null {
  return useContext(PlaybackContext);
}
