/**
 * The turn engine end to end, with a scripted model, for the contact details
 * the business most needs: a prospect who gives a number must never be asked
 * for it again, and must never lose it.
 */
import { describe, expect, it } from 'vitest';
import { runTurn } from '../src/agents/turn-engine.js';
import { parseEnv } from '../src/lib/env.js';
import { initialCallState } from '../src/services/calls.js';
import type { LlmProvider, StreamTextOptions } from '../src/services/llm/types.js';
import type { CallState, TranscriptTurn } from '../src/types/domain.js';

const env = parseEnv({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-value',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value',
  LLM_PROVIDER: 'glm',
  GLM_API_KEY: 'glm-key',
  GLM_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
  CALL_TOKEN_SECRET: 'a'.repeat(64),
  ALLOWED_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'error',
  // These tests cover the full script's contact steps (email included).
  CALL_LENGTH: 'full',
});

const identity = {
  companyName: 'Helio Energy',
  agentName: 'Sam',
  consultantName: undefined,
  serviceArea: undefined,
  callbackNumber: undefined,
};

/** A model that says `reply`, records the prompt it was given, and extracts `extraction` (or fails). */
function fakeProvider(reply: string, extraction: unknown | Error) {
  const prompts: StreamTextOptions[] = [];
  const provider: LlmProvider = {
    name: 'fake',
    model: 'fake-1',
    async streamText(options) {
      prompts.push(options);
      async function* chunks() {
        yield reply;
      }
      return { chunks: chunks(), usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }) };
    },
    async extract<T>(options: { parse: (raw: unknown) => T }) {
      if (extraction instanceof Error) throw extraction;
      return { data: options.parse(extraction), usage: { inputTokens: 1, outputTokens: 1 } };
    },
    async ping() {
      return { ok: true as const, latencyMs: 1 };
    },
  };
  return { provider, prompts };
}

async function play(state: CallState, utterance: string, history: TranscriptTurn[], reply: string, extraction: unknown | Error) {
  const { provider, prompts } = fakeProvider(reply, extraction);
  const turn = runTurn(env, provider, { state, utterance, history, identity });
  const spoken: string[] = [];
  for await (const sentence of turn.sentences) spoken.push(sentence);
  return { result: await turn.result, prompt: prompts[0]?.system ?? '', spoken };
}

function openingState(): CallState {
  const state = initialCallState('call-1', 'lead-1', 'America/Los_Angeles');
  return { ...state, turnCount: 2, lead: { ...state.lead, name: 'Kevin' } };
}

const HISTORY: TranscriptTurn[] = [
  { speaker: 'agent', content: 'Who am I speaking with?', stage: 'opening' },
  { speaker: 'prospect', content: 'I am Kevin', stage: 'opening' },
  {
    speaker: 'agent',
    content: 'Nice to meet you Kevin. Just in case we get cut off, what is the best number to reach you?',
    stage: 'opening',
  },
];

describe('runTurn — contact details', () => {
  it('writes the reply already knowing the number the prospect just gave', async () => {
    const { prompt } = await play(
      { ...openingState(), beats: { sgip: false, pitch: false, phoneAsked: true, emailAsked: false, recap: false } },
      'yeah it is 510 555 1212',
      HISTORY,
      'Got it, 510 555 1212. And what is a good email to send the details to?',
      { lead_patch: {} },
    );

    expect(prompt).toMatch(/Phone: 510-555-1212/);
    expect(prompt).not.toMatch(/the best phone number to reach them/);
  });

  it('keeps the number on the lead even when extraction fails', async () => {
    const { result } = await play(
      openingState(),
      'my number is 510 555 1212',
      HISTORY,
      'Perfect. And what is a good email to send the details over to?',
      new Error('extractor unavailable'),
    );

    expect(result.state.lead.phone).toBe('510-555-1212');
  });

  it('prefers what the extractor heard over the quick read', async () => {
    const { result } = await play(
      openingState(),
      'kevin at gmail dot com',
      HISTORY,
      'Thanks Kevin. And are you the owner of the home?',
      { lead_patch: { email: 'kevin.s@gmail.com' } },
    );

    expect(result.state.lead.email).toBe('kevin.s@gmail.com');
  });

  it('stays in the opening while the email is still unasked, then moves on', async () => {
    const owner = await play(
      { ...openingState(), lead: { name: 'Kevin', phone: '510-555-1212' } },
      'yes I own it',
      HISTORY,
      'Great. What is a good email to send the details over to?',
      { lead_patch: { homeowner_confirmed: true } },
    );
    // The email was asked for in this very reply — it has not been answered.
    expect(owner.result.state.stage).toBe('opening');
    expect(owner.result.state.beats.emailAsked).toBe(true);

    const declined = await play(
      owner.result.state,
      "I'd rather not give that out",
      HISTORY,
      'No problem at all. So the reason I am calling is about the rate increases in your area.',
      { lead_patch: {} },
    );
    expect(declined.result.state.stage).toBe('rapport');
  });
});

describe('runTurn — model outage', () => {
  it('asks the prospect to repeat instead of claiming not to know', async () => {
    const { provider } = fakeProvider('', new Error('extractor unavailable'));
    provider.streamText = async () => {
      throw new Error('The model did not respond in time');
    };

    const turn = runTurn(env, provider, {
      state: openingState(),
      utterance: 'I am Kevin',
      history: HISTORY,
      identity,
    });
    const spoken: string[] = [];
    for await (const sentence of turn.sentences) spoken.push(sentence);

    expect(spoken.join(' ')).toMatch(/cut out|went quiet|missed the last bit/);
    expect(spoken.join(' ')).not.toMatch(/not 100% sure/);
    expect((await turn.result).usedFallback).toBe(true);
  });
});
