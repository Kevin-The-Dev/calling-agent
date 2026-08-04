/**
 * Browser speech input and output (decision D8).
 *
 * Speech-to-text uses the Web Speech API; text-to-speech uses
 * `speechSynthesis`. Neither needs a key or costs anything, which is what makes
 * the MVP runnable today — see implementation.md R8 and R13 for the trade-offs,
 * chiefly that Firefox has no SpeechRecognition and that synthesized audio
 * cannot be captured into a recording.
 *
 * Both are wrapped behind small interfaces so swapping in Deepgram/ElevenLabs
 * later touches only this file.
 */

// The Web Speech API is not in TypeScript's DOM lib.
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface BrowserSupport {
  speechRecognition: boolean;
  speechSynthesis: boolean;
  mediaRecorder: boolean;
  supported: boolean;
  reason?: string;
}

/**
 * Feature detection, run before a call starts.
 * D8 makes the browser the entire voice stack, so an unsupported browser must
 * produce a clear message rather than a call that silently never hears anything.
 */
export function detectSupport(): BrowserSupport {
  if (typeof window === 'undefined') {
    return {
      speechRecognition: false,
      speechSynthesis: false,
      mediaRecorder: false,
      supported: false,
    };
  }

  const speechRecognition = getRecognitionConstructor() !== null;
  const synthesis = 'speechSynthesis' in window;
  const recorder = typeof MediaRecorder !== 'undefined';

  const support: BrowserSupport = {
    speechRecognition,
    speechSynthesis: synthesis,
    mediaRecorder: recorder,
    supported: speechRecognition && synthesis,
  };

  if (!speechRecognition) {
    support.reason =
      'This browser cannot listen for speech. Please use Chrome, Edge, or Safari — Firefox does not support the Web Speech API.';
  } else if (!synthesis) {
    support.reason = 'This browser cannot play synthesized speech.';
  }

  return support;
}

// ─── Speech recognition ──────────────────────────────────────────────────────

export interface ListenerCallbacks {
  /** Partial transcript, updated live. */
  onInterim?: (text: string) => void;
  /** A finished utterance, ready to send as a turn. */
  onFinal: (text: string, confidence: number) => void;
  /** Speech detected while the agent is talking — used for barge-in. */
  onSpeechStart?: () => void;
  onError?: (error: string) => void;
}

export interface Listener {
  start(): void;
  stop(): void;
  /** Pause while the agent speaks, so its own voice is not transcribed. */
  mute(): void;
  unmute(): void;
  readonly listening: boolean;
}

export function createListener(language: string, callbacks: ListenerCallbacks): Listener {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) throw new Error('SpeechRecognition is not available in this browser');

  const recognition = new Recognition();
  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let running = false;
  let muted = false;
  let stopping = false;

  recognition.onresult = (event) => {
    if (muted) return;

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result) continue;
      const alternative = result[0];
      if (!alternative) continue;

      const text = alternative.transcript.trim();
      if (text.length === 0) continue;

      if (result.isFinal) {
        callbacks.onFinal(text, alternative.confidence);
      } else {
        callbacks.onSpeechStart?.();
        callbacks.onInterim?.(text);
      }
    }
  };

  recognition.onerror = (event) => {
    // 'no-speech' and 'aborted' are routine during a conversation, not failures.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    callbacks.onError?.(event.error);
  };

  // Chrome ends recognition on its own after a pause. Restart unless the call
  // is genuinely over, otherwise the agent goes deaf mid-conversation.
  recognition.onend = () => {
    running = false;
    if (!stopping) {
      try {
        recognition.start();
        running = true;
      } catch {
        // Already starting; the next onend will retry.
      }
    }
  };

  return {
    start() {
      stopping = false;
      if (running) return;
      try {
        recognition.start();
        running = true;
      } catch {
        // start() throws if already started — harmless.
      }
    },
    stop() {
      stopping = true;
      running = false;
      recognition.abort();
    },
    mute() {
      muted = true;
    },
    unmute() {
      muted = false;
    },
    get listening() {
      return running && !muted;
    },
  };
}

// ─── Speech synthesis ────────────────────────────────────────────────────────

export interface Speaker {
  /** Queues a sentence. Sentences play in order as they arrive. */
  speak(text: string): void;
  /** Barge-in: stop immediately and drop anything queued. */
  cancel(): void;
  readonly speaking: boolean;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Picks the most natural available voice.
 * Quality varies wildly by platform, and the default is often the worst one —
 * on macOS/iOS the enhanced voices are markedly better than "Alex".
 */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  const preferred = [
    'Google US English',
    'Samantha',
    'Microsoft Aria Online (Natural) - English (United States)',
    'Microsoft Jenny Online (Natural) - English (United States)',
    'Karen',
    'Daniel',
  ];

  for (const name of preferred) {
    const match = voices.find((v) => v.name === name);
    if (match) return match;
  }

  return voices.find((v) => v.lang.startsWith('en') && v.localService === false)
    ?? voices.find((v) => v.lang.startsWith('en'))
    ?? voices[0]
    ?? null;
}

export function createSpeaker(rate = 1.0): Speaker {
  const queue: string[] = [];
  let active = false;
  let voice: SpeechSynthesisVoice | null = null;
  let cancelled = false;

  const ensureVoice = () => {
    voice ??= pickVoice();
  };

  // Voices load asynchronously in Chrome.
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      voice = pickVoice();
    };
  }

  const speaker: Speaker = {
    speak(text: string) {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      cancelled = false;
      queue.push(trimmed);
      if (!active) playNext();
    },
    cancel() {
      cancelled = true;
      queue.length = 0;
      active = false;
      window.speechSynthesis.cancel();
    },
    get speaking() {
      return active;
    },
  };

  function playNext() {
    const next = queue.shift();
    if (next === undefined) {
      if (active) {
        active = false;
        speaker.onEnd?.();
      }
      return;
    }

    ensureVoice();

    const utterance = new SpeechSynthesisUtterance(next);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = 1;

    if (!active) {
      active = true;
      speaker.onStart?.();
    }

    utterance.onend = () => {
      if (cancelled) return;
      playNext();
    };
    // A synthesis error must not stall the queue and leave the call silent.
    utterance.onerror = () => {
      if (cancelled) return;
      playNext();
    };

    window.speechSynthesis.speak(utterance);
  }

  return speaker;
}
