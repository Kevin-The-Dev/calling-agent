/**
 * Keeps the speakers awake for the length of a call.
 *
 * Bluetooth headphones (AirPods especially) and many laptop audio outputs power
 * down after a moment of silence and take a fraction of a second to wake up.
 * The agent speaks in separate sentences with gaps between them, so the device
 * went to sleep in every gap and the first syllable or word of the next
 * sentence played into a device that was not ready yet — heard as the voice
 * cutting off the start of what it says.
 *
 * Playing a tone far below hearing level for the whole call keeps the output
 * open. It is not audible and is not recorded: the recording is taken from the
 * microphone, not from what the page plays.
 */

export interface OutputKeepAlive {
  stop(): void;
}

/** Quiet enough to be inaudible on any speaker, loud enough that the device stays on. */
const KEEPALIVE_GAIN = 0.0004;

/**
 * Starts the tone. Must be called from the click that starts the call — a
 * browser only lets a page start audio in response to a user gesture.
 * Returns a no-op handle where Web Audio is unavailable.
 */
export function startOutputKeepAlive(): OutputKeepAlive {
  const AudioContextCtor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AudioContextCtor) return { stop: () => undefined };

  try {
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 40;
    gain.gain.value = KEEPALIVE_GAIN;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    void context.resume().catch(() => undefined);

    return {
      stop() {
        try {
          oscillator.stop();
        } catch {
          // Already stopped.
        }
        void context.close().catch(() => undefined);
      },
    };
  } catch {
    // Audio unavailable — the call still works, it just may clip a syllable.
    return { stop: () => undefined };
  }
}
