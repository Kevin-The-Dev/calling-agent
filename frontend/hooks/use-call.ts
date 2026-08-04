'use client';

/**
 * Drives one voice call.
 *
 * Owns the whole loop: listen → send the utterance → stream the reply →
 * speak each sentence as it arrives → listen again.
 *
 * Two details matter more than they look:
 *
 *   - The listener is muted while the agent speaks. Without it the browser
 *     transcribes the agent's own synthesized voice and the call talks to
 *     itself.
 *   - Speech detected during playback cancels the queue (barge-in), because a
 *     real setter stops talking the moment the prospect starts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPublicEnv } from '@/lib/env';
import {
  createListener,
  createSpeaker,
  detectSupport,
  type Listener,
  type Speaker,
} from '@/voice/speech';

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
  supported: boolean;
  supportReason: string | undefined;
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
  const [outcome, setOutcome] = useState<string | null>(null);
  const [support] = useState(() => detectSupport());

  const callRef = useRef<{ callId: string; token: string } | null>(null);
  const listenerRef = useRef<Listener | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const finishedRef = useRef(false);

  const append = useCallback((speaker: 'agent' | 'prospect', text: string) => {
    setTranscript((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, speaker, text },
    ]);
  }, []);

  /** Sends one utterance and speaks the streamed reply sentence by sentence. */
  const sendTurn = useCallback(
    async (utterance: string, silent = false) => {
      const call = callRef.current;
      if (!call || busyRef.current || finishedRef.current) return;

      busyRef.current = true;
      setPhase('thinking');
      listenerRef.current?.mute();

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const { apiBaseUrl } = getPublicEnv();
        const response = await fetch(`${apiBaseUrl}/api/calls/${call.callId}/turn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Call-Token': call.token },
          body: JSON.stringify({ utterance }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`The call service returned ${response.status}`);
        }

        if (!silent) append('prospect', utterance);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let reply = '';

        setPhase('speaking');

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
              // Speak immediately — this is what keeps perceived latency low.
              speakerRef.current?.speak(text);
            } else if (event === 'done') {
              setStage(String(payload['stage'] ?? ''));
              if (payload['finished'] === true) {
                finishedRef.current = true;
                setOutcome(String(payload['outcome'] ?? 'ended'));
              }
            } else if (event === 'error') {
              const errPayload = payload['error'] as { message?: string } | undefined;
              throw new Error(errPayload?.message ?? 'The call service failed');
            }
          }
        }

        if (reply) append('agent', reply);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Something went wrong on the call.');
      } finally {
        busyRef.current = false;
        abortRef.current = null;
      }
    },
    [append],
  );

  const start = useCallback(async () => {
    if (!support.supported) {
      setError(support.reason ?? 'This browser cannot run a voice call.');
      return;
    }

    setError(null);
    setPhase('connecting');
    finishedRef.current = false;

    try {
      // Prompt for the microphone before anything else, so a denial surfaces
      // immediately rather than as silence once the agent starts talking.
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access is required for this call.');
      setPhase('idle');
      return;
    }

    try {
      const { apiBaseUrl, sttLanguage } = getPublicEnv();
      const response = await fetch(`${apiBaseUrl}/api/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true }),
      });

      if (!response.ok) throw new Error('Could not start the call.');
      const data = (await response.json()) as { callId: string; token: string };
      callRef.current = { callId: data.callId, token: data.token };

      const speaker = createSpeaker();
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

      const listener = createListener(sttLanguage, {
        onInterim: (text) => setInterim(text),
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
          void sendTurn(text);
        },
        onError: (err) => {
          if (err === 'not-allowed' || err === 'service-not-allowed') {
            setError('Microphone access was blocked.');
          }
        },
      });
      listenerRef.current = listener;
      listener.start();

      // The agent opens the conversation.
      await sendTurn(OPENING_UTTERANCE, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the call.');
      setPhase('idle');
    }
  }, [sendTurn, support]);

  const end = useCallback(async () => {
    listenerRef.current?.stop();
    speakerRef.current?.cancel();
    abortRef.current?.abort();
    setPhase('ended');

    const call = callRef.current;
    if (!call) return;

    try {
      const { apiBaseUrl } = getPublicEnv();
      const response = await fetch(`${apiBaseUrl}/api/calls/${call.callId}/end`, {
        method: 'POST',
        headers: { 'X-Call-Token': call.token },
      });
      if (response.ok) {
        const data = (await response.json()) as { outcome?: string };
        setOutcome(data.outcome ?? 'abandoned');
      }
    } catch {
      // The call is already over on the client; a failed finalize is logged
      // server-side and does not need to surface to the prospect.
    }
  }, []);

  // Never leave recognition or synthesis running after unmount.
  useEffect(() => {
    return () => {
      listenerRef.current?.stop();
      speakerRef.current?.cancel();
      abortRef.current?.abort();
    };
  }, []);

  return {
    phase,
    transcript,
    interim,
    error,
    stage,
    outcome,
    supported: support.supported,
    supportReason: support.reason,
    start,
    end,
  };
}
