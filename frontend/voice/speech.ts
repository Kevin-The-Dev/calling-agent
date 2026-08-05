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

export interface ListenerOptions {
  /**
   * How long the transcript may sit unchanged before the utterance is treated
   * as finished. See `createListener` for why this exists.
   */
  endpointMs?: number;
}

/**
 * Default endpointing window.
 *
 * Long enough to survive the pause in "my bill is… about two hundred", short
 * enough that the agent does not feel slow. 650ms tested as the point where
 * mid-sentence thinking pauses stop being cut off.
 */
const DEFAULT_ENDPOINT_MS = 650;

export function createListener(
  language: string,
  callbacks: ListenerCallbacks,
  options: ListenerOptions = {},
): Listener {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) throw new Error('SpeechRecognition is not available in this browser');

  const endpointMs = options.endpointMs ?? DEFAULT_ENDPOINT_MS;

  const recognition = new Recognition();
  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let running = false;
  let muted = false;
  let stopping = false;

  // ── Endpointing ────────────────────────────────────────────────────────────
  //
  // Chrome decides an utterance is over on its own schedule — roughly 1.5s of
  // silence before `isFinal` arrives. On a phone call that reads as the agent
  // being slow, and it is the single largest contributor to perceived latency,
  // larger than the model and the database combined.
  //
  // So we make the call ourselves: once the interim transcript stops changing
  // for `endpointMs`, the prospect has stopped talking and the turn goes out.
  // Chrome's own final result then arrives for an utterance already in flight
  // and is dropped — sending it again would ask the agent to answer the same
  // sentence twice.
  let pending = '';
  let pendingConfidence = 0;
  let endpointTimer: ReturnType<typeof setTimeout> | null = null;
  let awaitingDiscardedFinal = false;

  const clearEndpointTimer = () => {
    if (endpointTimer === null) return;
    clearTimeout(endpointTimer);
    endpointTimer = null;
  };

  const flush = () => {
    clearEndpointTimer();

    const text = pending.trim();
    pending = '';
    if (text.length === 0) return;

    // Chrome will still deliver its own final for this utterance shortly.
    awaitingDiscardedFinal = true;
    callbacks.onFinal(text, pendingConfidence);
  };

  const armEndpointTimer = () => {
    clearEndpointTimer();
    endpointTimer = setTimeout(flush, endpointMs);
  };

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
        clearEndpointTimer();
        pending = '';

        // Already sent by the endpointer. Chrome's version may be slightly
        // better punctuated, but the turn is gone and the agent may already be
        // speaking; re-sending would double the utterance.
        if (awaitingDiscardedFinal) {
          awaitingDiscardedFinal = false;
          continue;
        }

        callbacks.onFinal(text, alternative.confidence);
      } else {
        callbacks.onSpeechStart?.();
        callbacks.onInterim?.(text);

        // Only restart the clock when the words actually changed. Chrome
        // re-emits an identical interim while the prospect is silent, and
        // treating that as speech would keep the timer alive forever.
        if (text !== pending) {
          pending = text;
          pendingConfidence = alternative.confidence;
          armEndpointTimer();
        }
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
      clearEndpointTimer();
      pending = '';
      awaitingDiscardedFinal = false;
      recognition.abort();
    },
    mute() {
      muted = true;
      // Anything half-heard when the agent started speaking is abandoned, not
      // sent late — by the time it fired the conversation would have moved on.
      clearEndpointTimer();
      pending = '';
      // The flag only ever guards the one utterance the endpointer just sent.
      // Chrome's matching final normally arrives while muted and is dropped by
      // `onresult` before the flag is read, so it survived into the next
      // utterance — and if Chrome finalized that one faster than our 650ms
      // endpointer (a short answer: "yeah", "PG and E") the flag ate it. The
      // prospect had answered, the agent heard nothing, and the call sat in
      // silence until they spoke again.
      awaitingDiscardedFinal = false;
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
  /**
   * Opens the agent's turn and claims the microphone floor.
   *
   * Call this before the first sentence of a reply arrives, not when it does.
   * Sentences stream in one at a time, so the queue runs dry between them; the
   * open turn is what stops a dry queue from being mistaken for the end of the
   * reply. See `playNext` for what that mistake costs.
   */
  beginTurn(): void;
  /** Queues a sentence. Sentences play in order as they arrive. */
  speak(text: string): void;
  /**
   * Marks the reply complete — no further sentences are coming.
   * The floor is released once the queue has drained, which may be some seconds
   * later, or immediately if the turn produced no audio at all.
   */
  endTurn(): void;
  /** Barge-in: stop immediately, drop anything queued, release the floor. */
  cancel(): void;
  /**
   * Spins the synthesis engine up ahead of the first real sentence.
   * Call it on the user gesture that starts the call.
   */
  warm(): void;
  /** True while an utterance is actually audible. */
  readonly speaking: boolean;
  /** True for the whole agent turn, including the gaps between sentences. */
  readonly holdingFloor: boolean;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Delay between synthesis reporting the end of the last sentence and the
 * microphone being handed back.
 *
 * Chrome fires `utterance.onend` a beat before the audio has finished leaving
 * the speakers. Reopening the microphone on that edge lets it catch the tail of
 * the agent's own final word and send it back as a prospect turn.
 */
const SPEECH_TAIL_MS = 250;

/**
 * Rough speaking rate, in characters per second, at rate 1.0.
 *
 * Only used to size the watchdog below, so it is deliberately generous rather
 * than accurate — over-estimating costs a longer wait before recovery,
 * under-estimating cuts a sentence off.
 */
const CHARS_PER_SECOND = 12;

/** Slack added to the estimate before the watchdog decides synthesis is stuck. */
const WATCHDOG_SLACK_MS = 4000;

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

export function createSpeaker(rate = 1.0, tailMs = SPEECH_TAIL_MS): Speaker {
  const queue: string[] = [];
  let voice: SpeechSynthesisVoice | null = null;

  /** An utterance is audible right now. */
  let playing = false;
  /** More sentences may still arrive for the current reply. */
  let turnOpen = false;
  /** The agent owns the microphone until this clears. */
  let floorHeld = false;
  let announcedStart = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  // Bumped by `cancel()`. Utterances carry the generation they were queued
  // under, so an `onend` that arrives after a barge-in cannot resume a queue
  // that belongs to the next turn.
  let generation = 0;

  const ensureVoice = () => {
    voice ??= pickVoice();
  };

  // Voices load asynchronously in Chrome.
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      voice = pickVoice();
    };
  }

  const clearReleaseTimer = () => {
    if (releaseTimer === null) return;
    clearTimeout(releaseTimer);
    releaseTimer = null;
  };

  const clearWatchdog = () => {
    if (watchdogTimer === null) return;
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  };

  /**
   * Hands the microphone back.
   * `immediate` skips the tail delay for barge-in and hang-up, where the audio
   * is being cut off rather than allowed to finish.
   */
  const release = (immediate: boolean) => {
    if (!floorHeld) return;
    floorHeld = false;
    announcedStart = false;
    clearReleaseTimer();

    if (immediate || tailMs <= 0) {
      speaker.onEnd?.();
      return;
    }

    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      speaker.onEnd?.();
    }, tailMs);
  };

  const speaker: Speaker = {
    beginTurn() {
      clearReleaseTimer();
      turnOpen = true;
      floorHeld = true;
    },
    speak(text: string) {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      // A sentence outside an open turn still owns the floor while it plays.
      // Without this the microphone would stay live through it.
      if (!floorHeld) {
        floorHeld = true;
        turnOpen = true;
      }
      queue.push(trimmed);
      if (!playing) playNext(generation);
    },
    endTurn() {
      turnOpen = false;
      // A turn that produced no audio — every sentence blocked by a guardrail,
      // or the request failed before the first one — must still hand the
      // microphone back, or the call is deaf for the rest of the conversation.
      if (!playing && queue.length === 0) release(false);
    },
    cancel() {
      generation += 1;
      queue.length = 0;
      playing = false;
      turnOpen = false;
      clearWatchdog();
      window.speechSynthesis.cancel();
      release(true);
    },
    warm() {
      // The first `speak()` of a page's life carries the engine's start-up
      // cost, and browsers only permit synthesis after a user gesture anyway.
      // Spending it on a silent utterance means the agent's opening line plays
      // the moment it arrives instead of a few hundred ms later.
      ensureVoice();
      const primer = new SpeechSynthesisUtterance(' ');
      if (voice) primer.voice = voice;
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
    },
    get speaking() {
      return playing;
    },
    get holdingFloor() {
      return floorHeld;
    },
  };

  function playNext(gen: number) {
    // A cancelled turn's trailing `onend` must not resume the next turn's queue.
    if (gen !== generation) return;

    clearWatchdog();

    const next = queue.shift();
    if (next === undefined) {
      playing = false;

      // The queue runs dry between every pair of sentences in a streamed
      // reply — sentence two is still being generated when sentence one
      // finishes playing. Releasing the floor here is what reopened the
      // microphone mid-reply, letting it transcribe the agent's own remaining
      // sentences straight back as prospect turns and answer itself.
      if (turnOpen) return;

      release(false);
      return;
    }

    ensureVoice();
    playing = true;

    if (!announcedStart) {
      announcedStart = true;
      speaker.onStart?.();
    }

    const utterance = new SpeechSynthesisUtterance(next);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = 1;

    // Exactly one of `onend`, `onerror` or the watchdog moves the queue on —
    // whichever gets there first. Without this the watchdog's `cancel()` would
    // fire `onend` on its way out and skip the sentence after this one.
    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      playNext(gen);
    };

    utterance.onend = advance;
    // A synthesis error must not stall the queue and leave the call silent.
    utterance.onerror = advance;

    // Watchdog.
    //
    // `speechSynthesis` in Chrome drops `onend` outright often enough to be a
    // real failure mode: a long utterance, a backgrounded tab, or the engine
    // auto-pausing past ~15s all leave the callback unfired. Nothing else ever
    // clears `playing`, so the floor is never released, the microphone is never
    // reopened, and the call is deaf for the rest of its life — the prospect
    // talks and the agent never answers again.
    //
    // So the queue does not depend on the browser keeping its promise. If the
    // sentence has had comfortably longer than it could possibly need, move on.
    const estimatedMs = (next.length / CHARS_PER_SECOND / rate) * 1000;
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      if (gen !== generation || advanced) return;
      // Leave the engine in a known state before the next sentence is queued.
      window.speechSynthesis.cancel();
      advance();
    }, estimatedMs + WATCHDOG_SLACK_MS);

    window.speechSynthesis.speak(utterance);
  }

  return speaker;
}
