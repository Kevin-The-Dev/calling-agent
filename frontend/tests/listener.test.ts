/**
 * The listener is the boundary between the prospect's voice and a turn sent to
 * the agent. Every bug here shows up on a call as either the agent answering
 * itself or the agent going deaf, so these tests drive it with a scripted
 * stand-in for the browser's SpeechRecognition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createListener } from '@/voice/speech';

interface FakeResult {
  transcript: string;
  isFinal: boolean;
}

/** Mimics Chrome's SpeechRecognition closely enough to reproduce its timing quirks. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];

  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;

  /** Live session, as the engine sees it. */
  running = false;
  starts = 0;
  aborts = 0;
  /** Results accumulated in the current session — Chrome resends them all each event. */
  private results: FakeResult[] = [];

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    if (this.running) throw new Error('InvalidStateError: already started');
    this.running = true;
    this.starts += 1;
    this.results = [];
  }

  stop() {
    this.abort();
  }

  /** Real engines end asynchronously; `endSession()` delivers it. */
  abort() {
    this.aborts += 1;
  }

  /** Delivers the asynchronous end of the session. */
  endSession() {
    this.running = false;
    this.onend?.();
  }

  /** The engine hears speech: updates (or finalizes) the current result. */
  hear(transcript: string, isFinal = false) {
    const last = this.results.at(-1);
    if (last && !last.isFinal) {
      last.transcript = transcript;
      last.isFinal = isFinal;
    } else {
      this.results.push({ transcript, isFinal });
    }
    const index = this.results.length - 1;
    const list = this.results.map((r) =>
      Object.assign([{ transcript: r.transcript, confidence: 0.9 }], { isFinal: r.isFinal }),
    );
    this.onresult?.({ resultIndex: index, results: list });
  }

  error(code: string) {
    this.onerror?.({ error: code });
  }
}

const recognition = () => {
  const instance = FakeRecognition.instances.at(-1);
  if (!instance) throw new Error('no recognition created');
  return instance;
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.instances = [];
  vi.stubGlobal('window', { SpeechRecognition: FakeRecognition });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(endpointMs = 650) {
  const onFinal = vi.fn<(text: string, confidence: number) => void>();
  const onInterim = vi.fn<(text: string) => void>();
  const onError = vi.fn<(error: string) => void>();
  const listener = createListener('en-US', { onFinal, onInterim, onError }, { endpointMs });
  return { listener, onFinal, onInterim, onError, rec: recognition() };
}

describe('createListener — the agent must never hear itself', () => {
  it('reproduces the reported bug: agent speech buffered while muted is never sent', () => {
    const { listener, onFinal, rec } = setup();
    listener.start();

    // Prospect: "I am Kevin" — sent by the endpointer.
    rec.hear('I am Kevin');
    vi.advanceTimersByTime(650);
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenLastCalledWith('I am Kevin', 0.9);

    // The agent takes the floor. The session must end, not merely be ignored.
    listener.mute();
    expect(rec.aborts).toBe(1);

    // Before the abort lands, the engine is still transcribing the agent.
    rec.hear('hey Kevin nice to meet you and are you the owner');
    rec.endSession();

    // The agent finishes; a fresh session opens.
    listener.unmute();
    expect(rec.starts).toBe(2);

    // Without the fix, Chrome finalized the agent's question here and the
    // listener sent it as the prospect's answer.
    vi.advanceTimersByTime(5000);
    expect(onFinal).toHaveBeenCalledTimes(1);

    // The prospect's real answer still gets through.
    rec.hear('yes I am');
    vi.advanceTimersByTime(650);
    expect(onFinal).toHaveBeenCalledTimes(2);
    expect(onFinal).toHaveBeenLastCalledWith('yes I am', 0.9);
  });

  it('opens the next session only after the aborted one has ended', () => {
    const { listener, rec } = setup();
    listener.start();
    listener.mute();
    // The agent turn was short — unmuted before the engine reported the end.
    listener.unmute();
    expect(rec.starts).toBe(1);
    expect(listener.listening).toBe(false);

    rec.endSession();
    expect(rec.starts).toBe(2);
    expect(listener.listening).toBe(true);
  });

  it('stays closed while the agent holds the floor, even when the engine ends on its own', () => {
    const { listener, rec } = setup();
    listener.start();
    listener.mute();
    rec.endSession();
    vi.advanceTimersByTime(10_000);
    expect(rec.starts).toBe(1);
  });

  it('drops a pending half-utterance when the agent takes the floor', () => {
    const { listener, onFinal, rec } = setup();
    listener.start();
    rec.hear('my bill is about');
    listener.mute();
    vi.advanceTimersByTime(5000);
    expect(onFinal).not.toHaveBeenCalled();
  });
});

describe('createListener — letting the prospect finish', () => {
  it('sends once the words have been still for the wait', () => {
    const { listener, onFinal, onInterim, rec } = setup(1200);
    listener.start();

    rec.hear('about two hundred');
    vi.advanceTimersByTime(1000);
    rec.hear('about two hundred a month');
    vi.advanceTimersByTime(1199);
    expect(onFinal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onFinal).toHaveBeenCalledWith('about two hundred a month', 0.9);
    expect(onInterim).toHaveBeenCalledTimes(2);
  });

  it('does not end the turn on a short thinking pause', () => {
    // The reported problem: a one-second pause mid-sentence ended the turn.
    const { listener, onFinal, rec } = setup(1200);
    listener.start();
    rec.hear('yeah I think it is around');
    vi.advanceTimersByTime(1000);
    rec.hear('yeah I think it is around two eighty');
    vi.advanceTimersByTime(1200);
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('yeah I think it is around two eighty', 0.9);
  });

  it('waits twice as long when the words so far stop mid-thought', () => {
    const { listener, onFinal, rec } = setup(1200);
    listener.start();
    rec.hear('my bill is about');
    vi.advanceTimersByTime(2399);
    expect(onFinal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFinal).toHaveBeenCalledWith('my bill is about', 0.9);
  });

  it("never sends on Chrome's own mid-sentence segment break", () => {
    // Chrome marks a segment final at any small pause. That used to send the
    // first half of the sentence on its own.
    const { listener, onFinal, rec } = setup(1200);
    listener.start();
    rec.hear('we have a single family home', true);
    expect(onFinal).not.toHaveBeenCalled();

    rec.hear('and we own the roof');
    vi.advanceTimersByTime(1200);
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('we have a single family home and we own the roof', 0.9);
  });

  it('sends only what was said since the last turn', () => {
    const { listener, onFinal, rec } = setup(1200);
    listener.start();
    rec.hear('yes', true);
    vi.advanceTimersByTime(1200);
    rec.hear('my number is 510 555 1212');
    vi.advanceTimersByTime(1200);
    expect(onFinal.mock.calls.map((c) => c[0])).toEqual(['yes', 'my number is 510 555 1212']);
  });

  it('does not restart the clock when Chrome re-emits identical words', () => {
    const { listener, onFinal, rec } = setup(1200);
    listener.start();
    rec.hear('yeah');
    vi.advanceTimersByTime(800);
    rec.hear('yeah');
    vi.advanceTimersByTime(400);
    expect(onFinal).toHaveBeenCalledTimes(1);
  });

  it('keeps the words when Chrome ends its session mid-sentence', () => {
    const { listener, onFinal, rec } = setup(1200);
    listener.start();
    vi.advanceTimersByTime(5000); // a long-lived session, so the restart is immediate
    rec.hear('it is a single family');
    rec.endSession();
    expect(rec.starts).toBe(2);

    rec.hear('home with a tile roof');
    vi.advanceTimersByTime(1200);
    expect(onFinal).toHaveBeenCalledWith('it is a single family home with a tile roof', 0.9);
  });
});

describe('createListener — staying alive', () => {
  it('restarts when the engine ends a session by itself', () => {
    const { listener, rec } = setup();
    listener.start();
    vi.advanceTimersByTime(5000);
    rec.endSession();
    expect(rec.starts).toBe(2);
  });

  it('backs off instead of spinning when sessions keep dying immediately', () => {
    const { listener, rec } = setup();
    listener.start();
    rec.endSession();
    expect(rec.starts).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(rec.starts).toBe(2);
  });

  it('stops retrying after a permission error and reports it', () => {
    const { listener, onError, rec } = setup();
    listener.start();
    rec.error('not-allowed');
    rec.endSession();
    vi.advanceTimersByTime(10_000);
    expect(rec.starts).toBe(1);
    expect(onError).toHaveBeenCalledWith('not-allowed');
  });

  it('treats no-speech as routine', () => {
    const { listener, onError, rec } = setup();
    listener.start();
    rec.error('no-speech');
    expect(onError).not.toHaveBeenCalled();
  });

  it('never restarts after stop()', () => {
    const { listener, rec } = setup();
    listener.start();
    listener.stop();
    rec.endSession();
    vi.advanceTimersByTime(10_000);
    expect(rec.starts).toBe(1);
    expect(listener.listening).toBe(false);
  });
});
