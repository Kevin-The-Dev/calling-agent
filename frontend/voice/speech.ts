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
  onError?: (error: string) => void;
}

export interface Listener {
  start(): void;
  stop(): void;
  /**
   * Closes the ear while the agent speaks.
   *
   * This ends the recognition session outright rather than ignoring its
   * results, and that difference is the whole fix for the agent answering its
   * own questions. A session left running keeps transcribing the agent's voice
   * into an utterance it has not finalized yet; ignoring events while muted
   * hides that, but the utterance survives, and the first event after
   * `unmute()` delivers it — the agent's question, as the prospect's answer.
   */
  mute(): void;
  /** Opens a fresh session that has heard nothing of the agent's turn. */
  unmute(): void;
  readonly listening: boolean;
}

/**
 * Recognition errors that will recur on every restart. Retrying them is a
 * tight loop of start → error → end → start that never hears anything.
 */
const FATAL_RECOGNITION_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

/**
 * A session the browser ends this soon after it started, without us asking,
 * is treated as a failing engine and restarted after a pause rather than at
 * once, so a transient fault does not spin the CPU.
 */
const QUICK_END_MS = 1000;
const RESTART_BACKOFF_MS = 1000;

export interface ListenerOptions {
  /**
   * How long the transcript may sit unchanged before the utterance is treated
   * as finished. See `createListener` for why this exists.
   */
  endpointMs?: number;
}

/**
 * How long the prospect must be silent before their turn is sent.
 *
 * It was 650ms, and in real calls that cut people off constantly: a breath, an
 * "um", or a second spent remembering a bill amount all run longer than that,
 * and the agent jumped in and answered half a sentence. 1.2s lets an ordinary
 * thinking pause pass while still replying faster than a person on the phone
 * would.
 */
export const DEFAULT_ENDPOINT_MS = 1200;

/**
 * Words a sentence does not end on. When what has been heard so far stops on
 * one of these, the speaker is mid-thought — "my bill is about…", "we have
 * the, um…" — and gets twice as long before their turn is sent.
 */
const UNFINISHED_ENDING =
  /\b(?:and|but|so|or|because|cause|um+|uh+|er+|hmm+|like|the|a|an|my|our|your|is|was|are|were|to|of|for|with|that|about|if|then|i|we|it's|i'm|its|around|maybe|probably|just|well|basically|actually|in|on|at|from|by)\s*[,.…-]*$/i;

/** The silence to wait for, given what has been said so far. */
export function endpointDelay(text: string, endpointMs: number): number {
  return UNFINISHED_ENDING.test(text.trim()) ? endpointMs * 2 : endpointMs;
}

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

  /** The call wants the ear open: `start()` was called and `stop()` was not. */
  let wanted = false;
  /** The agent holds the floor. */
  let muted = false;
  /** A session is live — `recognition.start()` succeeded and `onend` has not fired. */
  let active = false;
  /**
   * `abort()` has been issued and the session's `onend` is still to come.
   * Anything it reports in that window is from before the abort and is dropped.
   */
  let draining = false;
  let sessionStartedAt = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRestartTimer = () => {
    if (restartTimer === null) return;
    clearTimeout(restartTimer);
    restartTimer = null;
  };

  // ── Deciding the prospect has finished ────────────────────────────────────
  //
  // One rule, and only one: the turn is sent when the words have stopped
  // changing for `endpointDelay()`. Chrome's own "final" results do NOT send
  // anything. Chrome marks a segment final at any short pause, mid-sentence
  // included, and treating that as the end of the turn is what made the agent
  // reply to the first half of what someone was saying.
  //
  // The whole session's transcript is re-read on every event, and the words
  // already sent are skipped, so everything said since the last send — across
  // any number of Chrome segments — goes out as one utterance.
  let pending = '';
  let pendingConfidence = 0;
  let endpointTimer: ReturnType<typeof setTimeout> | null = null;
  /** Words of this session's transcript already sent as a turn. */
  let sentWords = 0;
  /** Words in this session's transcript so far. */
  let sessionWords = 0;
  /**
   * Unsent words from a session Chrome ended by itself mid-utterance. They
   * belong to the same turn as whatever comes next.
   */
  let carried = '';

  const clearEndpointTimer = () => {
    if (endpointTimer === null) return;
    clearTimeout(endpointTimer);
    endpointTimer = null;
  };

  /** Forgets everything heard since the last send. */
  const resetUtterance = () => {
    clearEndpointTimer();
    pending = '';
    carried = '';
    sentWords = sessionWords;
  };

  const flush = () => {
    const text = pending.trim();
    resetUtterance();
    if (text.length === 0) return;
    callbacks.onFinal(text, pendingConfidence);
  };

  const armEndpointTimer = (text: string) => {
    clearEndpointTimer();
    endpointTimer = setTimeout(flush, endpointDelay(text, endpointMs));
  };

  /** Starts a session if the call wants one and none is running. */
  const open = () => {
    clearRestartTimer();
    if (!wanted || muted || active) return;
    try {
      recognition.start();
      active = true;
      draining = false;
      sessionStartedAt = Date.now();
      // A new session reports its transcript from scratch.
      sentWords = 0;
      sessionWords = 0;
    } catch {
      // The engine still considers the previous session live — its `onend`
      // has not been delivered. Try again shortly rather than go deaf.
      restartTimer = setTimeout(open, RESTART_BACKOFF_MS / 4);
    }
  };

  /** Ends the session and throws away everything it heard. */
  const close = () => {
    clearRestartTimer();
    resetUtterance();
    if (!active || draining) return;
    draining = true;
    // `abort()`, not `stop()`: stop asks the engine to finalize what it has
    // heard — the agent's voice — and deliver it.
    recognition.abort();
  };

  recognition.onresult = (event) => {
    if (muted || draining) return;

    let transcript = '';
    let confidence = 0;
    for (let i = 0; i < event.results.length; i += 1) {
      const alternative = event.results[i]?.[0];
      if (!alternative) continue;
      transcript += ` ${alternative.transcript}`;
      confidence = alternative.confidence;
    }

    const words = transcript.trim().split(/\s+/).filter(Boolean);
    sessionWords = words.length;
    // Chrome sometimes rewrites what it already reported ("PG and E" becomes
    // "PG&E"), which can shorten the transcript below what was sent.
    if (sentWords > words.length) sentWords = words.length;

    const text = [carried, words.slice(sentWords).join(' ')].filter(Boolean).join(' ');
    // Only restart the clock when the words actually changed. Chrome re-emits
    // an identical result while the prospect is silent, and treating that as
    // speech would keep the timer alive forever.
    if (text.length === 0 || text === pending) return;

    pending = text;
    pendingConfidence = confidence;
    callbacks.onInterim?.(text);
    armEndpointTimer(text);
  };

  recognition.onerror = (event) => {
    // 'no-speech' and 'aborted' are routine during a conversation, not failures.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    if (FATAL_RECOGNITION_ERRORS.has(event.error)) {
      // Stop the restart loop; the call layer decides what to tell the prospect.
      wanted = false;
      clearEndpointTimer();
      pending = '';
    }
    callbacks.onError?.(event.error);
  };

  // Chrome ends recognition on its own after a pause. Restart unless the call
  // is over or the agent has the floor, otherwise the agent goes deaf
  // mid-conversation.
  recognition.onend = () => {
    const wasClosedByUs = draining;
    const lived = Date.now() - sessionStartedAt;
    active = false;
    draining = false;

    if (!wanted || muted) return;
    // Chrome ended the session by itself while the prospect was mid-utterance.
    // Keep what they said; the timer is still running and the next session's
    // words join it.
    if (!wasClosedByUs) carried = pending;
    if (!wasClosedByUs && lived < QUICK_END_MS) {
      restartTimer = setTimeout(open, RESTART_BACKOFF_MS);
      return;
    }
    open();
  };

  return {
    start() {
      wanted = true;
      open();
    },
    stop() {
      wanted = false;
      close();
    },
    mute() {
      muted = true;
      // Anything half-heard when the agent started speaking is abandoned, not
      // sent late — by the time it fired the conversation would have moved on.
      close();
    },
    unmute() {
      muted = false;
      // If the aborted session has not reported `onend` yet, `open()` is a
      // no-op and `onend` opens the new one.
      open();
    },
    get listening() {
      return active && !draining && !muted;
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
  /**
   * Queues a sentence. Sentences play in order as they arrive.
   * `hooks` report when this sentence starts being heard and when it is done,
   * so the transcript can show which sentence the voice is on.
   */
  speak(text: string, hooks?: SentenceHooks): void;
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

export interface SentenceHooks {
  /** The sentence is being handed to the synthesis engine — audio follows. */
  onStart?: () => void;
  /** The sentence finished, failed, was skipped by the watchdog, or was cancelled. */
  onDone?: () => void;
}

/**
 * How long a reply's text is on screen before its voice starts.
 *
 * The transcript is the prospect's way of checking what they are hearing, so
 * it must never trail the audio. Sentences that arrive while the voice is busy
 * are on screen long before their turn comes; this lead only applies to the
 * first sentence of a reply, the one that would otherwise race its own text.
 */
export const TEXT_LEAD_MS = 200;

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
const CHARS_PER_SECOND = 9;

/**
 * Slack added to the estimate before the watchdog decides synthesis is stuck.
 * Generous on purpose: firing early cancels a sentence the voice is still in
 * the middle of — heard as the agent swallowing the end of what it was saying.
 */
const WATCHDOG_SLACK_MS = 6000;

/**
 * The longest piece handed to the speech engine at once. Chrome's voices can
 * stop partway through a long utterance, so longer sentences are split at
 * their commas and spoken back to back.
 */
const MAX_UTTERANCE_CHARS = 160;

/**
 * Rewrites text into what the speech engine should actually say.
 *
 * The transcript keeps the text as written; only the audio uses this. Browser
 * voices skip or garble several things the agent writes all the time: "—" is
 * swallowed along with the words around it on some voices, "&" is silent
 * ("PG&E" came out as "PG E"), and "510-555-1212" is read as a subtraction.
 */
export function speakable(text: string): string {
  return text
    .replace(/\*+/g, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\b(\d{3})[-.\s](\d{3})[-.\s](\d{4})\b/g, (_, a: string, b: string, c: string) =>
      [a, b, c].map((group) => group.split('').join(' ')).join(', '),
    )
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Splits text into pieces short enough to be spoken reliably, at commas where possible. */
export function speechChunks(text: string, max = MAX_UTTERANCE_CHARS): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    // The last comma (or failing that, space) inside the limit.
    let cut = window.lastIndexOf(', ');
    if (cut < max / 3) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
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

export function createSpeaker(
  rate = 1.0,
  tailMs = SPEECH_TAIL_MS,
  leadMs = 0,
): Speaker {
  const queue: { text: string; hooks: SentenceHooks | undefined }[] = [];
  /** The pause before a reply's first sentence; see `TEXT_LEAD_MS`. */
  let leadTimer: ReturnType<typeof setTimeout> | null = null;
  /** The sentence on air, so a cancel can tell it it is done. */
  let current: SentenceHooks | undefined;
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
    speak(text: string, hooks?: SentenceHooks) {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        hooks?.onDone?.();
        return;
      }
      // A sentence outside an open turn still owns the floor while it plays.
      // Without this the microphone would stay live through it.
      if (!floorHeld) {
        floorHeld = true;
        turnOpen = true;
      }
      // One sentence may become several utterances. The transcript still
      // treats it as one: it starts with the first piece and is done after the
      // last.
      const pieces = speechChunks(speakable(trimmed)).filter(Boolean);
      if (pieces.length === 0) {
        hooks?.onDone?.();
        return;
      }
      pieces.forEach((piece, i) => {
        queue.push({
          text: piece,
          hooks:
            pieces.length === 1
              ? hooks
              : {
                  ...(i === 0 && hooks?.onStart ? { onStart: hooks.onStart } : {}),
                  ...(i === pieces.length - 1 && hooks?.onDone ? { onDone: hooks.onDone } : {}),
                },
        });
      });
      if (playing || leadTimer !== null) return;

      if (leadMs <= 0) {
        playNext(generation);
        return;
      }
      // Let the text land on screen first. See `TEXT_LEAD_MS`.
      const gen = generation;
      leadTimer = setTimeout(() => {
        leadTimer = null;
        playNext(gen);
      }, leadMs);
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
      if (leadTimer !== null) {
        clearTimeout(leadTimer);
        leadTimer = null;
      }
      // Everything still owed a `done` gets it, so nothing on screen is left
      // marked as about to be spoken.
      current?.onDone?.();
      current = undefined;
      for (const item of queue) item.hooks?.onDone?.();
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
      //
      // Wrapped because this runs inside the same try block that starts the
      // call. Warming up is an optimization; a synthesis engine that rejects
      // the primer must cost a few hundred milliseconds, not the whole call.
      try {
        ensureVoice();
        const primer = new SpeechSynthesisUtterance(' ');
        if (voice) primer.voice = voice;
        primer.volume = 0;
        window.speechSynthesis.speak(primer);
      } catch {
        // The real utterances will pay the start-up cost instead.
      }
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

    current = next.hooks;
    next.hooks?.onStart?.();

    const utterance = new SpeechSynthesisUtterance(next.text);
    // Assigning a voice the engine will not accept throws, and throwing here
    // would abandon the queue mid-reply. The default voice is worse than the
    // chosen one and far better than silence.
    try {
      if (voice) utterance.voice = voice;
    } catch {
      voice = null;
    }
    utterance.rate = rate;
    utterance.pitch = 1;

    // Exactly one of `onend`, `onerror` or the watchdog moves the queue on —
    // whichever gets there first. Without this the watchdog's `cancel()` would
    // fire `onend` on its way out and skip the sentence after this one.
    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      // A cancelled turn already told its sentences they were done.
      if (gen !== generation) return;
      if (current === next.hooks) current = undefined;
      next.hooks?.onDone?.();
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
    const estimatedMs = (next.text.length / CHARS_PER_SECOND / rate) * 1000;
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
