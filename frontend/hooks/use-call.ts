'use client';

/**
 * Drives one voice call.
 *
 * Owns the whole loop: listen → send the utterance → stream the reply →
 * speak each sentence as it arrives → listen again.
 *
 * Three details matter more than they look:
 *
 *   - Recognition is shut off for the agent's whole turn and restarted fresh
 *     afterwards. Browser synthesis plays outside the page's audio graph, so
 *     echo cancellation cannot remove it and the microphone hears the agent
 *     almost verbatim; a recognizer left running would hand that back as the
 *     prospect's answer and the call would talk to itself. The server's echo
 *     guard is the backstop for whatever still slips through.
 *   - For the same reason there is no barge-in: with no echo reference, the
 *     agent's voice and the prospect's are indistinguishable to the recognizer,
 *     and "speech during playback" would always be the agent interrupting
 *     itself.
 *   - The microphone stream is opened once and shared by recognition, the
 *     recorder, and the level meter. Opening it three times would show three
 *     recording indicators and, on some browsers, fail outright.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, fetchApi } from '@/lib/api';
import { describeApiBaseUrlProblem, getPublicEnv } from '@/lib/env';
import {
  TEXT_LEAD_MS,
  createListener,
  createSpeaker,
  detectSupport,
  type BrowserSupport,
  type Listener,
  type Speaker,
} from '@/voice/speech';
import { createLevelMeter, type LevelMeter } from '@/voice/level-meter';
import { startRecording, type Recorder } from '@/voice/recorder';
import { startOutputKeepAlive, type OutputKeepAlive } from '@/voice/output-keepalive';

export type CallPhase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';

/** Where one sentence of an agent reply is, relative to the voice. */
export type SentenceStatus = 'pending' | 'speaking' | 'spoken';

export interface TranscriptEntry {
  id: string;
  speaker: 'agent' | 'prospect';
  text: string;
  /**
   * An agent reply, sentence by sentence, with how far the voice has got.
   *
   * The text of a reply goes on screen the moment each sentence arrives — ahead
   * of its audio — so the prospect can read along and check that what they hear
   * is what was said. The status lets the console show which sentence is being
   * spoken right now.
   */
  sentences?: { text: string; status: SentenceStatus }[];
}

export interface UseCallResult {
  phase: CallPhase;
  transcript: TranscriptEntry[];
  interim: string;
  error: string | null;
  stage: string | null;
  /** The steps this call walks through, as the server reported them. */
  stages: string[] | null;
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

export function useCall(): UseCallResult {
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [stages, setStages] = useState<string[] | null>(null);
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
  const keepAliveRef = useRef<OutputKeepAlive | null>(null);
  const startedAtRef = useRef<number>(0);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const finishedRef = useRef(false);
  /**
   * Set once the call has been closed out with the backend. Closing out writes
   * the appointment, the summary and the outcome, so it must happen exactly
   * once however the call ends — the agent wrapping up, the End button, or the
   * tab closing.
   */
  const finalizedRef = useRef(false);
  /** `end`, reachable from callbacks created before it was. */
  const endRef = useRef<() => Promise<void>>(async () => undefined);
  /**
   * When the current utterance began, in ms from the start of the recording.
   * Null between utterances. Recognition reports words, not timestamps, so the
   * first interim result is the closest thing to a speech-onset marker.
   */
  const utteranceStartRef = useRef<number | null>(null);
  /**
   * The turn that has been sent but not yet answered out loud.
   *
   * Until the agent's first sentence arrives, the prospect may simply not have
   * been finished — they paused, and the pause was taken for the end of their
   * turn. If they carry on talking in that window, this turn is withdrawn and
   * its words are prefixed to what they say next, so the agent answers the
   * whole sentence rather than the first half of it.
   */
  const inFlightRef = useRef<{
    utterance: string;
    lineId: string | null;
    controller: AbortController;
    startMs: number | null;
    answered: boolean;
  } | null>(null);
  /** Words from a withdrawn turn, waiting to be joined to the rest of the sentence. */
  const carryRef = useRef<{ text: string; startMs: number | null } | null>(null);

  /** Adds a line to the transcript and returns its id, so it can be corrected later. */
  const append = useCallback((speaker: 'agent' | 'prospect', text: string): string => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTranscript((prev) => [...prev, { id, speaker, text }]);
    return id;
  }, []);

  /** Adds a sentence to an agent line, creating the line on the first one. Returns its index. */
  const addSentence = useCallback((id: string, text: string) => {
    setTranscript((prev) => {
      const existing = prev.find((entry) => entry.id === id);
      if (!existing) {
        return [
          ...prev,
          { id, speaker: 'agent', text, sentences: [{ text, status: 'pending' }] },
        ];
      }
      return prev.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              text: `${entry.text} ${text}`,
              sentences: [...(entry.sentences ?? []), { text, status: 'pending' }],
            }
          : entry,
      );
    });
  }, []);

  /** Moves one sentence of an agent line along: pending → speaking → spoken. */
  const markSentence = useCallback((id: string, index: number, status: SentenceStatus) => {
    setTranscript((prev) =>
      prev.map((entry) => {
        const sentence = entry.id === id ? entry.sentences?.[index] : undefined;
        // Never move backwards — a late `onStart` must not undo a `done`.
        if (!entry.sentences || !sentence || sentence.status === 'spoken') return entry;
        const sentences = entry.sentences.slice();
        sentences[index] = { text: sentence.text, status };
        return { ...entry, sentences };
      }),
    );
  }, []);

  /** Rewrites a line in place, or removes it when `text` is null. */
  const revise = useCallback((id: string, text: string | null) => {
    setTranscript((prev) =>
      text === null
        ? prev.filter((entry) => entry.id !== id)
        : prev.map((entry) => (entry.id === id ? { ...entry, text } : entry)),
    );
  }, []);

  /** Releases the microphone, the recorder, and the meter. Safe to call twice. */
  const teardownAudio = useCallback(() => {
    meterRef.current?.stop();
    meterRef.current = null;
    keepAliveRef.current?.stop();
    keepAliveRef.current = null;

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
      // The microphone stays open while the reply is being prepared — the agent
      // is silent then, so there is nothing of its own to overhear — and closes
      // the moment it starts to speak (see the 'sentence' event below). The
      // prospect who was not actually finished can keep talking. The opening
      // line is the exception: nobody is mid-sentence before the call starts.
      if (silent) listenerRef.current?.mute();
      utteranceStartRef.current = null;
      // Claim the microphone for the whole reply, before the first sentence
      // exists. The floor is only given back once the stream has finished AND
      // the last sentence has finished playing.
      speakerRef.current?.beginTurn();

      // Shown before the request goes out, not after it returns — the prospect
      // said it a moment ago and should see it immediately.
      const lineId = silent ? null : append('prospect', utterance);

      const controller = new AbortController();
      abortRef.current = controller;
      const inFlight = silent
        ? null
        : { utterance, lineId, controller, startMs: audio?.startMs ?? null, answered: false };
      inFlightRef.current = inFlight;

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
        /** The agent's line for this reply; created by its first sentence. */
        const replyId = `${Date.now()}-agent-${Math.random().toString(36).slice(2, 8)}`;
        let sentenceCount = 0;
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
              const text = String(payload['text'] ?? '').trim();
              if (!text) continue;
              const index = sentenceCount;
              sentenceCount += 1;

              // Text first: the sentence is on screen before its voice starts
              // (the speaker waits `TEXT_LEAD_MS` when it is idle), so what the
              // prospect reads is always ahead of, and identical to, what they
              // hear.
              // The agent is about to speak: from here the turn stands, and the
              // microphone closes so it cannot hear its own voice.
              if (inFlight && !inFlight.answered) {
                inFlight.answered = true;
                listenerRef.current?.mute();
              }
              addSentence(replyId, text);
              // Only now is the agent genuinely speaking. Flipping the phase
              // when the response headers arrived would show "Speaking" during
              // a silence the model had not finished thinking through.
              setPhase('speaking');
              speakerRef.current?.speak(text, {
                onStart: () => markSentence(replyId, index, 'speaking'),
                onDone: () => markSentence(replyId, index, 'spoken'),
              });
            } else if (event === 'ignored') {
              // The server recognised the agent's own voice. The prospect never
              // said it, so it comes off the transcript; `speech-end` follows
              // and hands the microphone straight back.
              if (lineId) revise(lineId, null);
            } else if (event === 'heard') {
              // An echoed lead-in was cut from the front of the real answer.
              if (lineId) revise(lineId, String(payload['text'] ?? utterance));
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
        // reply unabortable on hang-up and let a third turn overlap it.
        if (abortRef.current === controller) {
          busyRef.current = false;
          abortRef.current = null;
        }
        if (inFlightRef.current === inFlight) inFlightRef.current = null;
      }
    },
    [addSentence, append, markSentence, revise],
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
    finalizedRef.current = false;
    utteranceStartRef.current = null;
    inFlightRef.current = null;
    carryRef.current = null;
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
      const data = (await response.json()) as {
        callId: string;
        token: string;
        stages?: string[];
      };
      if (Array.isArray(data.stages)) setStages(data.stages);
      callRef.current = { callId: data.callId, token: data.token };

      startedAtRef.current = Date.now();
      setElapsed(0);

      meterRef.current = createLevelMeter(stream);
      recorderRef.current = startRecording(stream);

      const speaker = createSpeaker(1, undefined, TEXT_LEAD_MS);
      // Still inside the click that started the call, which is the only moment
      // a browser will let synthesis initialize — or start any audio at all.
      speaker.warm();
      keepAliveRef.current?.stop();
      keepAliveRef.current = startOutputKeepAlive();
      speaker.onEnd = () => {
        if (finishedRef.current) {
          // The agent has said goodbye. Close the call out exactly as the End
          // button would: before this, a call the agent finished itself was
          // never closed out, so a booked appointment was never written, the
          // lead never showed as booked, there was no summary, and the
          // recording was never uploaded.
          void endRef.current();
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
            // They were not finished: a turn went out on a pause and they have
            // kept talking before the agent said a word. Withdraw it and hold
            // its words for the rest of the sentence.
            const pending = inFlightRef.current;
            if (pending && !pending.answered) {
              inFlightRef.current = null;
              carryRef.current = { text: pending.utterance, startMs: pending.startMs };
              busyRef.current = false;
              abortRef.current = null;
              pending.controller.abort();
              speakerRef.current?.cancel();
              if (pending.lineId) revise(pending.lineId, null);
            }

            const carry = carryRef.current;
            // First words of a new utterance — mark where it starts in the
            // recording so the dashboard can highlight it during playback.
            utteranceStartRef.current ??= carry?.startMs ?? Date.now() - startedAtRef.current;
            setInterim(carry ? `${carry.text} ${text}` : text);
          },
          onFinal: (heard) => {
            setInterim('');
            const carry = carryRef.current;
            carryRef.current = null;
            const text = carry ? `${carry.text} ${heard}` : heard;
            const startMs = utteranceStartRef.current;
            utteranceStartRef.current = null;

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
            } else if (err === 'audio-capture') {
              setError('No microphone was found. Check that one is connected and try again.');
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
  }, [revise, sendTurn, support, teardownAudio]);

  const end = useCallback(async () => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;

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

  endRef.current = end;

  // A visitor who closes the tab mid-call never presses End. The beacon is the
  // one request a closing page reliably gets out; it cannot carry headers, so
  // the token rides in the query string (see the `/end` route). The recording
  // is lost — it is far too large for a beacon — but the transcript, the lead
  // and the outcome are closed out.
  useEffect(() => {
    const onPageHide = () => {
      const call = callRef.current;
      if (!call || finalizedRef.current) return;
      finalizedRef.current = true;
      try {
        navigator.sendBeacon(
          apiUrl(`/api/calls/${call.callId}/end?token=${encodeURIComponent(call.token)}`),
        );
      } catch {
        // Nothing more can be done from a page that is going away.
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

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
      keepAliveRef.current?.stop();
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
    stages,
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
