import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCallContextCache,
  dropCallContext,
  readCallContext,
  writeCallContext,
} from '../src/services/call-cache.js';
import { initialCallState } from '../src/services/calls.js';
import type { TranscriptTurn } from '../src/types/domain.js';

const state = (callId: string) => initialCallState(callId, `lead-${callId}`, 'America/Los_Angeles');

const turn = (content: string): TranscriptTurn => ({
  speaker: 'agent',
  content,
  stage: 'opening',
});

describe('call context cache', () => {
  beforeEach(() => {
    clearCallContextCache();
  });

  it('returns null for a call it has never seen', () => {
    expect(readCallContext('unknown')).toBeNull();
  });

  it('round-trips a stored context', () => {
    writeCallContext('call-1', { state: state('call-1'), history: [turn('hello')] });

    const context = readCallContext('call-1');
    expect(context?.state.callId).toBe('call-1');
    expect(context?.history).toHaveLength(1);
  });

  it('replaces the previous context rather than accumulating', () => {
    writeCallContext('call-1', { state: state('call-1'), history: [turn('one')] });
    writeCallContext('call-1', { state: state('call-1'), history: [turn('one'), turn('two')] });

    expect(readCallContext('call-1')?.history).toHaveLength(2);
  });

  it('caps history to the window the prompt actually uses', () => {
    const history = Array.from({ length: 60 }, (_, i) => turn(`turn ${i}`));
    writeCallContext('call-1', { state: state('call-1'), history });

    const cached = readCallContext('call-1')?.history ?? [];
    expect(cached).toHaveLength(40);
    // The window keeps the most recent turns, not the oldest.
    expect(cached.at(-1)?.content).toBe('turn 59');
  });

  it('forgets a dropped call', () => {
    writeCallContext('call-1', { state: state('call-1'), history: [] });
    dropCallContext('call-1');

    expect(readCallContext('call-1')).toBeNull();
  });

  it('evicts least-recently-used entries past the cap', () => {
    for (let i = 0; i < 520; i += 1) {
      writeCallContext(`call-${i}`, { state: state(`call-${i}`), history: [] });
    }

    // The oldest writes are gone; the newest survive.
    expect(readCallContext('call-0')).toBeNull();
    expect(readCallContext('call-519')?.state.callId).toBe('call-519');
  });

  it('keeps a re-read entry alive through eviction pressure', () => {
    writeCallContext('call-keep', { state: state('call-keep'), history: [] });

    for (let i = 0; i < 400; i += 1) {
      writeCallContext(`call-${i}`, { state: state(`call-${i}`), history: [] });
      // Reading marks it most-recently-used, which is what protects it.
      readCallContext('call-keep');
    }
    for (let i = 400; i < 520; i += 1) {
      writeCallContext(`call-${i}`, { state: state(`call-${i}`), history: [] });
      readCallContext('call-keep');
    }

    expect(readCallContext('call-keep')?.state.callId).toBe('call-keep');
  });
});

describe('initialCallState', () => {
  it('starts a call at the opening stage with nothing known', () => {
    const fresh = initialCallState('call-1', 'lead-1', 'America/Los_Angeles');

    expect(fresh.stage).toBe('opening');
    expect(fresh.turnCount).toBe(0);
    expect(fresh.qualificationScore).toBe(0);
    expect(fresh.outcome).toBeNull();
    expect(fresh.doNotContact).toBe(false);
    expect(fresh.lead.timezone).toBe('America/Los_Angeles');
  });
});
