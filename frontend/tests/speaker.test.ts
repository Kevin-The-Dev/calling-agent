/**
 * The speaker decides when the microphone is handed back. Releasing the floor
 * a moment too early is how the agent's own sentences reached the recognizer,
 * so these tests pin down exactly when `onEnd` may fire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeaker, speakable, speechChunks } from '@/voice/speech';

class FakeUtterance {
  voice: unknown = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

let spoken: FakeUtterance[] = [];
const synthesis = {
  speak: (u: FakeUtterance) => {
    spoken.push(u);
  },
  cancel: vi.fn(),
  getVoices: () => [],
  onvoiceschanged: null as unknown,
};

/** Finishes the utterance currently playing. */
const finishCurrent = () => spoken.filter((u) => u.text.trim()).at(-1)?.onend?.();

beforeEach(() => {
  vi.useFakeTimers();
  spoken = [];
  synthesis.cancel.mockClear();
  vi.stubGlobal('window', { speechSynthesis: synthesis });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createSpeaker — floor control', () => {
  it('holds the floor through the gap between streamed sentences', () => {
    const speaker = createSpeaker(1, 250);
    const onEnd = vi.fn();
    speaker.onEnd = onEnd;

    speaker.beginTurn();
    speaker.speak('Hey Kevin, nice to meet you.');
    finishCurrent();
    // Sentence two is still being generated. The queue is empty but the turn
    // is open — reopening the microphone here is what let it hear the agent.
    vi.advanceTimersByTime(2000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(speaker.holdingFloor).toBe(true);

    speaker.speak('And are you the owner of the property?');
    speaker.endTurn();
    finishCurrent();

    // The tail delay covers audio still leaving the speakers.
    vi.advanceTimersByTime(249);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(speaker.holdingFloor).toBe(false);
  });

  it('releases the floor at once for a turn that produced no audio', () => {
    // An echo the server ignored, or a reply blocked by a guardrail.
    const speaker = createSpeaker(1, 250);
    const onEnd = vi.fn();
    speaker.onEnd = onEnd;

    speaker.beginTurn();
    speaker.endTurn();
    vi.advanceTimersByTime(250);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('recovers when the browser never fires onend', () => {
    const speaker = createSpeaker(1, 0);
    const onEnd = vi.fn();
    speaker.onEnd = onEnd;

    speaker.beginTurn();
    speaker.speak('Hi.');
    speaker.endTurn();
    // No onend — the watchdog must move on rather than leave the call deaf.
    vi.advanceTimersByTime(10_000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale onend after cancel()', () => {
    const speaker = createSpeaker(1, 0);
    const onEnd = vi.fn();
    speaker.onEnd = onEnd;

    speaker.beginTurn();
    speaker.speak('First reply.');
    const stale = spoken.at(-1);
    speaker.cancel();
    expect(onEnd).toHaveBeenCalledTimes(1);

    speaker.beginTurn();
    speaker.speak('Second reply.');
    stale?.onend?.();
    // The second reply is still playing; the old callback must not end it.
    expect(speaker.speaking).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('createSpeaker — text before voice', () => {
  it('holds the first sentence for the lead time so its text lands first', () => {
    const speaker = createSpeaker(1, 0, 200);
    speaker.beginTurn();
    speaker.speak('Hey Kevin, nice to meet you.');

    // Nothing has reached the synthesis engine yet — the text is on screen alone.
    expect(spoken.filter((u) => u.text.trim())).toHaveLength(0);
    vi.advanceTimersByTime(199);
    expect(spoken.filter((u) => u.text.trim())).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(spoken.at(-1)?.text).toBe('Hey Kevin, nice to meet you.');
  });

  it('keeps sentences in order when a second one arrives during the lead', () => {
    const speaker = createSpeaker(1, 0, 200);
    speaker.beginTurn();
    speaker.speak('First.');
    speaker.speak('Second?');
    vi.advanceTimersByTime(200);
    expect(spoken.at(-1)?.text).toBe('First.');
    finishCurrent();
    expect(spoken.at(-1)?.text).toBe('Second?');
  });

  it('reports each sentence starting and finishing, in order', () => {
    const speaker = createSpeaker(1, 0, 0);
    const events: string[] = [];
    const hooks = (name: string) => ({
      onStart: () => events.push(`${name}:start`),
      onDone: () => events.push(`${name}:done`),
    });

    speaker.beginTurn();
    speaker.speak('One.', hooks('one'));
    speaker.speak('Two.', hooks('two'));
    expect(events).toEqual(['one:start']);
    finishCurrent();
    expect(events).toEqual(['one:start', 'one:done', 'two:start']);
    finishCurrent();
    expect(events).toEqual(['one:start', 'one:done', 'two:start', 'two:done']);
  });

  it('marks every unspoken sentence done when the call is hung up', () => {
    const speaker = createSpeaker(1, 0, 0);
    const done: string[] = [];
    speaker.beginTurn();
    speaker.speak('One.', { onDone: () => done.push('one') });
    speaker.speak('Two.', { onDone: () => done.push('two') });
    speaker.cancel();
    expect(done.sort()).toEqual(['one', 'two']);

    // The engine's late onend for the cut-off sentence must not report it twice.
    spoken.at(-1)?.onend?.();
    expect(done).toHaveLength(2);
  });
});

describe('speakable — what the voice actually says', () => {
  it.each([
    ['Got it — 510-555-1212.', 'Got it, 5 1 0, 5 5 5, 1 2 1 2.'],
    ['You are with PG&E, right?', 'You are with PG and E, right?'],
    ['So **this** is it', 'So this is it'],
    ['Perfect – see you then.', 'Perfect, see you then.'],
  ])('reads "%s" as "%s"', (written, said) => {
    expect(speakable(written)).toBe(said);
  });

  it('leaves ordinary sentences untouched', () => {
    expect(speakable("Wow, that's steep. What's the address?")).toBe(
      "Wow, that's steep. What's the address?",
    );
  });
});

describe('speechChunks', () => {
  it('keeps a normal sentence whole', () => {
    expect(speechChunks('Great, I have you down for Tuesday at 2.')).toHaveLength(1);
  });

  it('splits a long sentence at commas, losing no words', () => {
    const long =
      'Michael will come by 123 Maple Street on Tuesday at 2, he will call before heading over, have your latest electric bill handy, make sure anyone who helps decide is there, and there is nothing out of pocket at all.';
    const chunks = speechChunks(long, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 80)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });
});

describe('createSpeaker — long sentences', () => {
  it('speaks every piece of a split sentence and reports it once, start to finish', () => {
    const speaker = createSpeaker(1, 0, 0);
    const events: string[] = [];
    const long = `${'word '.repeat(45).trim()}, ${'more '.repeat(20).trim()}.`;

    speaker.beginTurn();
    speaker.speak(long, {
      onStart: () => events.push('start'),
      onDone: () => events.push('done'),
    });
    expect(events).toEqual(['start']);

    let guard = 0;
    while (speaker.speaking && guard++ < 10) finishCurrent();
    const said = spoken.filter((u) => u.text.trim()).map((u) => u.text);
    expect(said.length).toBeGreaterThan(1);
    expect(said.join(' ')).toBe(long);
    expect(events).toEqual(['start', 'done']);
  });
});
