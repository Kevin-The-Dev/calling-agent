'use client';

/**
 * Drives one voice call.
 *
 * Owns the whole loop: listen → send the utterance → stream the reply →
 * speak each sentence as it arrives → listen again.
 *
 * Three details matter more than they look:
 *
 *   - The listener is muted while the agent speaks. Without it the browser
 *     transcribes the agent's own synthesized voice and the call talks to
 *     itself.
 *   - Speech detected during playback cancels the queue (barge-in), because a
 *     real setter stops talking the moment the prospect starts.
 *   - The microphone stream is opened once and shared by recognition, the
 *     recorder, and the level meter. Opening it three times would show three
 *     recording indicators and, on some browsers, fail outright.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { describeApiBaseUrlProblem, getPublicEnv } from '@/lib/env';
import {
  createListener,
  createSpeaker,
  detectSupport,
  type BrowserSupport,
  type Listener,
  type Speaker,
} from '@/voice/speech';
import { createLevelMeter, type LevelMeter } from '@/voice/level-meter';
import { startRecording, type Recorder } from '@/voice/recorder';

export type CallPhase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';

export interface TranscriptEntry {
  id: string;
  speaker: 'agent' | 'prospect';
  text: string;
}

export interface UseCallResult {
  phase: CallPhase;
  transcript: TranscriptEntry[];
  interim: string;
  error: string | null;
  stage: string | null;
  outcome: string | null;
  /** Seconds since the call connected. */
  elapsed: number;
  supported: boolean;
  supportReason: string | undefined;
  /** Live microphone amplitude, 0..1. Read per animation frame, never rendered. */
  readLevel: () => number;
  start: () => Promise<void>;
  end: () => Promise<void>;
}

/** The agent speaks first, exactly as a setter would when a call connects. */
const OPENING_UTTERANCE = '__call_started__';

/** How many of the agent's most recent sentences the echo guard remembers. */
const ECHO_MEMORY = 6;

/**
 * Shortest transcript the echo guard will reject.
 *
 * Below four words a phrase is too generic to attribute — "yes", "about two
 * hundred" — and both the agent and the prospect plausibly said it. Dropping a
 * real answer stalls the call, so short utterances always go through.
 */
const ECHO_MIN_WORDS = 4;

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * True when a transcript is the agent hearing itself.
 *
 * Browser synthesis on macOS plays through the OS voice engine rather than the
 * page's audio pipeline, so `echoCancellation` has no reference signal to
 * subtract and the microphone picks the agent up almost verbatim. Holding the
 * microphone for the whole agent turn stops nearly all of it; this catches what
 * slips through in the moment the microphone reopens.
 */
function isEcho(candidate: string, spoken: readonly string[]): boolean {
  const text = normalize(candidate);
  if (text.split(' ').filter(Boolean).length < ECHO_MIN_WORDS) return false;
  return spoken.some((line) => line.includes(text));
}

export function useCall(): UseCallResult {
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /**
   * Null until the browser has been asked what it can do.
   *
   * `detectSupport()` reports nothing supported when there is no `window`, so
   * running it during render meant the server produced the "this browser cannot
   * run a voice call" alert and the client produced the consent gate. React
   * threw out the whole tree and re-rendered it on every single page load.
   *
   * Detection therefore happens after mount, and until it lands the console is
   * rendered as though the browser is fine: that matches what the server sends,
   * and `start()` re-checks before it does anything that would matter.
   */
  const [support, setSupport] = useState<BrowserSupport | null>(null);

  useEffect(() => {
    setSupport(detectSupport());
  }, []);

  const callRef = useRef<{ callId: string; token: string } | null>(null);
  const listenerRef = useRef<Listener | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const meterRef = useRef<LevelMeter | null>(null);
  const startedAtRef = useRef<number>(0);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const finishedRef = useRef(false);
  /** The agent's recent sentences, normalized, for the echo guard. */
  const spokenRef = useRef<string[]>([]);
  /**
   * When the current utterance began, in ms from the start of the recording.
   * Null between utterances. Recognition reports words, not timestamps, so the
   * first interim result is the closest thing to a speech-onset marker.
   */
  const utteranceStartRef = useRef<number | null>(null);

  const append = useCallback((speaker: 'agent' | 'prospect', text: string) => {
    setTranscript((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, speaker, text }]);
  }, []);

  /** Releases the microphone, the recorder, and the meter. Safe to call twice. */
  const teardownAudio = useCallback(() => {
    meterRef.current?.stop();
    meterRef.current = null;

    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  /** Sends one utterance and speaks the streamed reply sentence by sentence. */
  const sendTurn = useCallback(
    async (utterance: string, silent = false, audio?: { startMs: number; endMs: number }) => {
      const call = callRef.current;
      if (!call || busyRef.current || finishedRef.current) return;

      busyRef.current = true;
      setPhase('thinking');
      listenerRef.current?.mute();
      // `mute()` abandons anything half-heard, so its start marker would
      // otherwise be reused by the next utterance and date it far too early.
      utteranceStartRef.current = null;
      // Claim the microphone for the whole reply, before the first sentence
      // exists. The floor is only given back once the stream has finished AND
      // the last sentence has finished playing.
      speakerRef.current?.beginTurn();

      // Shown before the request goes out, not after it returns — the prospect
      // said it a moment ago and should see it immediately.
      if (!silent) append('prospect', utterance);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetchApi(`/api/calls/${call.callId}/turn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Call-Token': call.token },
          body: JSON.stringify(
            audio
              ? { utterance, audioStartMs: audio.startMs, audioEndMs: audio.endMs }
              : { utterance },
          ),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`The call service returned ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let reply = '';
        /** Set once `speech-end` has released the floor, so it is not released twice. */
        let turnClosed = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const event = /^event:\s*(.+)$/m.exec(frame)?.[1];
            const data = /^data:\s*(.+)$/m.exec(frame)?.[1];
            if (!data) continue;

            const payload = JSON.parse(data) as Record<string, unknown>;

            if (event === 'sentence') {
              const text = String(payload['text'] ?? '');
              reply += (reply ? ' ' : '') + text;
              // Only now is the agent genuinely speaking. Flipping the phase
              // when the response headers arrived would show "Speaking" during
              // a silence the model had not finished thinking through.
              setPhase('speaking');
              // Speak immediately — this is what keeps perceived latency low.
              speakerRef.current?.speak(text);
              // Remembered so the echo guard can recognise this sentence if the
              // microphone picks it back up off the speakers.
              spokenRef.current = [...spokenRef.current, normalize(text)].slice(-ECHO_MEMORY);
            } else if (event === 'speech-end') {
              // Every sentence has been sent. Close the turn here rather than
              // when the response body ends: the server keeps the stream open
              // while it extracts state and writes to the database, and holding
              // the microphone through that is a second of dead air after the
              // agent has plainly stopped talking — the single thing that makes
              // the call feel slow to the person on the other end.
              speakerRef.current?.endTurn();
              turnClosed = true;
            } else if (event === 'done') {
              setStage(String(payload['stage'] ?? ''));
              if (payload['finished'] === true) {
                finishedRef.current = true;
                setOutcome(String(payload['outcome'] ?? 'ended'));
              }
              // The server has folded this turn into the state the next one
              // will read. Everything after this point on the wire is the
              // transcript being written, which the next turn does not depend
              // on — so stop refusing new utterances here rather than at the
              // end of the body, or a quick answer lands while we are still
              // "busy" and is dropped without a trace.
              busyRef.current = false;
            } else if (event === 'error') {
              const errPayload = payload['error'] as { message?: string } | undefined;
              throw new Error(errPayload?.message ?? 'The call service failed');
            }
          }
        }

        if (reply) append('agent', reply);

        // Normally `speech-end` already did this. This covers the turn that
        // never got there — an old server, or a stream that ended early — and
        // leaving the floor held is a call that never hears anything again.
        if (!turnClosed) speakerRef.current?.endTurn();
      } catch (err) {
        // Barge-in and hang-up abort the request after cancelling the speaker,
        // which has already released the floor.
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Something went wrong on the call.');
        // Hand the microphone back. Leaving the floor held after a failed turn
        // is a dead call: the prospect talks and nothing is ever heard again.
        speakerRef.current?.endTurn();
      } finally {
        // `done` normally cleared this already. Only ever clear on behalf of
        // *this* turn: the prospect can now answer while the previous request
        // is still writing its transcript, so by the time this runs the refs may
        // belong to the turn after it — and blanking those would leave the next
        // reply unabortable on barge-in and let a third turn overlap it.
        if (abortRef.current === controller) {
          busyRef.current = false;
          abortRef.current = null;
        }
      }
    },
    [append],
  );

  /** Uploads the captured audio. Never throws — the call is already over. */
  const uploadRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    const call = callRef.current;
    recorderRef.current = null;
    if (!recorder || !call) return;

    try {
      const blob = await recorder.stop();
      if (!blob || blob.size === 0) return;

      const seconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));

      await fetchApi(`/api/calls/${call.callId}/recording`, {
        method: 'POST',
        headers: {
          'Content-Type': blob.type || 'audio/webm',
          'X-Call-Token': call.token,
          'X-Recording-Duration': String(seconds),
        },
        body: blob,
      });
    } catch {
      // A lost recording is a gap in the CRM, not a broken call. The prospect
      // has already hung up; there is nothing useful to tell them.
    }
  }, []);

  const start = useCallback(async () => {
    // Re-read rather than trust the render: detection lands a tick after mount,
    // and this is the moment it actually has to be right.
    const capability = support ?? detectSupport();
    if (!capability.supported) {
      setError(capability.reason ?? 'This browser cannot run a voice call.');
      return;
    }

    // Same pre-check the status pill makes. Worth repeating here because the
    // call button is reachable without ever reading that pill, and a bad base
    // URL would otherwise fail after the microphone prompt.
    const misconfigured = describeApiBaseUrlProblem();
    if (misconfigured) {
      setError(misconfigured);
      return;
    }

    setError(null);
    setPhase('connecting');
    finishedRef.current = false;
    spokenRef.current = [];
    utteranceStartRef.current = null;
    setTranscript([]);
    setInterim('');
    setOutcome(null);
    // Cleared here, not merely set once the call exists. The duration timer
    // starts the moment the phase leaves `idle`, which is the line above —
    // several seconds before `/api/calls` answers. Left at its initial 0 the
    // timer measured from the epoch and displayed 29766038:58; left at the
    // previous call's value it would quietly resume the last call's clock.
    startedAtRef.current = 0;
    setElapsed(0);

    let stream: MediaStream;
    try {
      // Prompt for the microphone before anything else, so a denial surfaces
      // immediately rather than as silence once the agent starts talking.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
    } catch {
      setError('Microphone access is required for this call.');
      setPhase('idle');
      return;
    }

    try {
      const { sttLanguage, endpointMs } = getPublicEnv();
      const response = await fetchApi('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true }),
      });

      if (!response.ok) throw new Error('Could not start the call.');
      const data = (await response.json()) as { callId: string; token: string };
      callRef.current = { callId: data.callId, token: data.token };

      startedAtRef.current = Date.now();
      setElapsed(0);

      meterRef.current = createLevelMeter(stream);
      recorderRef.current = startRecording(stream);

      const speaker = createSpeaker();
      // Still inside the click that started the call, which is the only moment
      // a browser will let synthesis initialize.
      speaker.warm();
      speaker.onEnd = () => {
        if (finishedRef.current) {
          setPhase('ended');
          listenerRef.current?.stop();
          return;
        }
        listenerRef.current?.unmute();
        setPhase('listening');
      };
      speakerRef.current = speaker;

      const listener = createListener(
        sttLanguage,
        {
          onInterim: (text) => {
            // First words of a new utterance — mark where it starts in the
            // recording so the dashboard can highlight it during playback.
            utteranceStartRef.current ??= Date.now() - startedAtRef.current;
            setInterim(text);
          },
          onSpeechStart: () => {
            // Barge-in: the prospect started talking over the agent.
            if (speakerRef.current?.speaking) {
              speakerRef.current.cancel();
              abortRef.current?.abort();
              setPhase('listening');
            }
          },
          onFinal: (text) => {
            setInterim('');
            const startMs = utteranceStartRef.current;
            utteranceStartRef.current = null;

            // The agent hearing its own voice off the speakers. Sending this
            // would have it answer its own question.
            if (isEcho(text, spokenRef.current)) return;

            const endMs = Date.now() - startedAtRef.current;
            void sendTurn(
              text,
              false,
              startMs === null ? undefined : { startMs, endMs: Math.max(startMs, endMs) },
            );
          },
          onError: (err) => {
            if (err === 'not-allowed' || err === 'service-not-allowed') {
              setError('Microphone access was blocked.');
            }
          },
        },
        { endpointMs },
      );
      listenerRef.current = listener;
      listener.start();

      // The agent opens the conversation.
      await sendTurn(OPENING_UTTERANCE, true);
    } catch (err) {
      teardownAudio();
      setError(err instanceof Error ? err.message : 'Could not start the call.');
      setPhase('idle');
    }
  }, [sendTurn, support, teardownAudio]);

  const end = useCallback(async () => {
    listenerRef.current?.stop();
    speakerRef.current?.cancel();
    abortRef.current?.abort();
    setPhase('ended');
    setInterim('');

    const call = callRef.current;
    if (!call) {
      teardownAudio();
      return;
    }

    // Finalize and upload together: the summary needs no audio and the upload
    // needs no outcome, so making them wait on each other only delays both.
    const [finalize] = await Promise.allSettled([
      (async () => {
        const response = await fetchApi(`/api/calls/${call.callId}/end`, {
          method: 'POST',
          headers: { 'X-Call-Token': call.token },
        });
        if (!response.ok) return null;
        return (await response.json()) as { outcome?: string };
      })(),
      uploadRecording(),
    ]);

    if (finalize.status === 'fulfilled' && finalize.value) {
      setOutcome(finalize.value.outcome ?? 'abandoned');
    }

    teardownAudio();
  }, [teardownAudio, uploadRecording]);

  // Call duration, for the console's timer.
  useEffect(() => {
    if (phase === 'idle' || phase === 'ended') return;

    const timer = setInterval(() => {
      // Zero means the call has not connected yet — `start()` clears it and the
      // backend's reply sets it. Counting from zero would be counting from 1970.
      if (startedAtRef.current === 0) return;
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [phase]);

  // Never leave recognition, synthesis, or the microphone running after unmount.
  useEffect(() => {
    return () => {
      listenerRef.current?.stop();
      speakerRef.current?.cancel();
      abortRef.current?.abort();
      recorderRef.current?.cancel();
      meterRef.current?.stop();
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    };
  }, []);

  const readLevel = useCallback(() => meterRef.current?.level ?? 0, []);

  return {
    phase,
    transcript,
    interim,
    error,
    stage,
    outcome,
    elapsed,
    // Optimistic until detection lands, so the first client render matches the
    // server's and the console does not flash an error it has not established.
    supported: support?.supported ?? true,
    supportReason: support?.reason,
    readLevel,
    start,
    end,
  };
}
