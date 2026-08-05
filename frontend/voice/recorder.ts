/**
 * Call recording.
 *
 * Captures the prospect's microphone for the duration of the call and hands
 * back one blob at the end, which the client uploads to the backend.
 *
 * Prospect only, deliberately. The agent speaks through `speechSynthesis`, and
 * browsers do not route synthesized audio into Web Audio or an output capture,
 * so there is nothing to mix it from — implementation.md R13, and the reason
 * `recordings.channels` defaults to 'prospect'. Moving to a streaming TTS
 * provider makes the agent's audio a real MediaStream and turns this into a
 * two-track mix without a schema change.
 */

export interface Recorder {
  /** Stops capture and resolves with everything recorded. Null if nothing was. */
  stop(): Promise<Blob | null>;
  /** Drops the recording without producing a blob. */
  cancel(): void;
  readonly mimeType: string;
  readonly recording: boolean;
}

/**
 * Picks a container the browser can actually produce.
 * Safari only recently gained MediaRecorder and prefers mp4; Chrome and Edge
 * want webm/opus. Order matters — the first supported type wins.
 */
function pickMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

/**
 * Starts recording the given stream.
 *
 * Returns null when the browser has no MediaRecorder — the call still runs, it
 * simply produces no audio file. A missing recording is never worth failing a
 * live conversation over.
 */
export function startRecording(stream: MediaStream): Recorder | null {
  if (typeof MediaRecorder === 'undefined') return null;

  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    return null;
  }

  const chunks: Blob[] = [];
  let cancelled = false;

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  // One-second timeslices rather than a single blob at stop: if the tab is
  // closed mid-call the browser has still flushed most of the audio, and it
  // keeps memory flat on a long conversation.
  recorder.start(1000);

  return {
    stop() {
      return new Promise<Blob | null>((resolve) => {
        if (recorder.state === 'inactive') {
          resolve(chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType }) : null);
          return;
        }

        recorder.onstop = () => {
          if (cancelled || chunks.length === 0) {
            resolve(null);
            return;
          }
          resolve(new Blob(chunks, { type: recorder.mimeType }));
        };

        try {
          recorder.stop();
        } catch {
          resolve(null);
        }
      });
    },
    cancel() {
      cancelled = true;
      chunks.length = 0;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // Already stopping.
        }
      }
    },
    get mimeType() {
      return recorder.mimeType || mimeType || 'audio/webm';
    },
    get recording() {
      return recorder.state === 'recording';
    },
  };
}
