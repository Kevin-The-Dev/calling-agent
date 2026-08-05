/**
 * Microphone level metering.
 *
 * Feeds the call console's voice orb. The orb is the main signal that the agent
 * is actually hearing something, so the movement has to come from the real
 * microphone — a looping CSS animation would keep dancing after the mic died,
 * which is precisely the moment the user most needs to be told.
 *
 * Values are written into a plain object rather than React state: this updates
 * ~60 times a second, and re-rendering a transcript that often to move a circle
 * is the wrong trade. The orb reads the value in its own animation frame.
 */

export interface LevelMeter {
  /** Smoothed RMS amplitude, 0..1. Read it, don't subscribe to it. */
  readonly level: number;
  stop(): void;
}

/** Rises fast so speech registers immediately, falls slow so the orb glides. */
const ATTACK = 0.5;
const RELEASE = 0.12;

export function createLevelMeter(stream: MediaStream): LevelMeter | null {
  const AudioContextCtor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

  if (!AudioContextCtor) return null;

  let context: AudioContext;
  try {
    context = new AudioContextCtor();
  } catch {
    return null;
  }

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  // Small window: we want responsiveness, not frequency resolution.
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  let smoothed = 0;
  let frame = 0;
  let stopped = false;

  const meter = {
    get level() {
      return smoothed;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close().catch(() => {
        // Closing a context that is already gone is not a failure.
      });
    },
  };

  const tick = () => {
    if (stopped) return;

    analyser.getByteTimeDomainData(samples);

    // RMS around the 128 midpoint of unsigned 8-bit PCM.
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const deviation = ((samples[i] ?? 128) - 128) / 128;
      sum += deviation * deviation;
    }
    const rms = Math.sqrt(sum / samples.length);

    // Speech sits low in a 0..1 RMS range; scale it into something an eye can
    // read, then clamp so a shout does not blow the orb out of its container.
    const scaled = Math.min(1, rms * 3.2);
    smoothed += (scaled - smoothed) * (scaled > smoothed ? ATTACK : RELEASE);

    frame = requestAnimationFrame(tick);
  };

  frame = requestAnimationFrame(tick);

  return meter;
}
