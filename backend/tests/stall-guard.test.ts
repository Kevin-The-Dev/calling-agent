/**
 * Mid-reply stall handling.
 *
 * Caught in end-to-end testing: a stream produced one sentence and then went
 * quiet. The request timeout is fifteen seconds, so the prospect heard "Perfect,
 * Dave." and then sat in silence with the microphone still held for fourteen
 * more before the turn gave up and delivered nothing else.
 */
import { describe, expect, it, vi } from 'vitest';
import { withStallGuard } from '../src/agents/turn-engine.js';

/** Emits `values`, pausing `gapMs` between each, then never resolves again. */
function slowStream(values: string[], gapMs: number, hangAtEnd = false) {
  return (async function* () {
    for (const value of values) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      yield value;
    }
    if (hangAtEnd) await new Promise(() => undefined);
  })();
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of iterable) out.push(value);
  return out;
}

describe('withStallGuard', () => {
  it('passes a healthy stream through untouched', async () => {
    const onStall = vi.fn();
    const chunks = await collect(withStallGuard(slowStream(['a', 'b', 'c'], 5), 200, onStall));

    expect(chunks).toEqual(['a', 'b', 'c']);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('keeps what was said and stops when the stream goes quiet', async () => {
    const onStall = vi.fn();
    // Two chunks, then silence forever.
    const source = (async function* () {
      yield 'Perfect, Dave.';
      yield ' ';
      await new Promise(() => undefined);
    })();

    const chunks = await collect(withStallGuard(source, 60, onStall));

    expect(chunks).toEqual(['Perfect, Dave.', ' ']);
    expect(onStall).toHaveBeenCalledOnce();
  });

  it('does not start the clock before the first chunk', async () => {
    const onStall = vi.fn();
    // 120ms to think, which is longer than the 60ms stall window. A model that
    // takes a moment to begin has not stalled, it has not started.
    const chunks = await collect(withStallGuard(slowStream(['hello'], 120), 60, onStall));

    expect(chunks).toEqual(['hello']);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('ends cleanly on a stream that simply finishes', async () => {
    const onStall = vi.fn();
    const source = (async function* () {
      yield 'one';
    })();

    expect(await collect(withStallGuard(source, 500, onStall))).toEqual(['one']);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('leaves teardown to onStall, because return() cannot reach a parked generator', async () => {
    // The contract that matters. A generator suspended on a promise that never
    // settles does not run its `finally` when `return()` is called, so the
    // guard cannot clean up the stream by itself: `onStall` aborts the request,
    // and the abort is what unblocks the read and runs the cleanup. The turn
    // engine relies on this, so it is worth pinning down.
    const cleanup = vi.fn();
    let unblock: (() => void) | undefined;

    const source = (async function* () {
      try {
        yield 'first';
        await new Promise<void>((resolve) => {
          unblock = resolve;
        });
        yield 'never reached';
      } finally {
        cleanup();
      }
    })();

    const onStall = vi.fn(() => unblock?.());
    const chunks = await collect(withStallGuard(source, 60, onStall));

    expect(chunks).toEqual(['first']);
    expect(onStall).toHaveBeenCalledOnce();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cleanup).toHaveBeenCalled();
  });

  it('returns without waiting on the dead stream', async () => {
    const source = (async function* () {
      yield 'first';
      // Nothing ever aborts this one.
      await new Promise(() => undefined);
    })();

    const started = Date.now();
    await collect(withStallGuard(source, 60, () => undefined));

    // The point of the whole thing: the caller is released on the stall window,
    // not on the request timeout that is fifteen seconds away.
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
