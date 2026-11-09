/**
 * The turn route must never feed the agent its own voice.
 *
 * Exercised end to end through the HTTP layer with a seeded call cache, so the
 * route needs neither Supabase nor a model: an echo is answered before either
 * would be touched.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/lib/env.js';
import { signCallToken } from '../src/lib/call-token.js';
import { clearCallContextCache, writeCallContext } from '../src/services/call-cache.js';
import { initialCallState } from '../src/services/calls.js';

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
});

const app = createApp(env);

const CALL_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_REPLY = 'Hey Kevin, nice to meet you. And are you the owner of the property?';

async function seedCall() {
  const state = initialCallState(CALL_ID, LEAD_ID, 'America/Los_Angeles');
  writeCallContext(CALL_ID, {
    state,
    history: [
      { speaker: 'prospect', content: 'I am Kevin', stage: state.stage },
      { speaker: 'agent', content: AGENT_REPLY, stage: state.stage },
    ],
  });
  return signCallToken(env.CALL_TOKEN_SECRET, {
    callId: CALL_ID,
    leadId: LEAD_ID,
    expiresAt: Date.now() + 60_000,
  });
}

function parseEvents(body: string): { event: string; data: unknown }[] {
  return body
    .split('\n\n')
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => ({
      event: /^event:\s*(.+)$/m.exec(frame)?.[1] ?? 'message',
      data: JSON.parse(/^data:\s*(.+)$/m.exec(frame)?.[1] ?? 'null') as unknown,
    }));
}

afterEach(() => clearCallContextCache());

describe('POST /api/calls/:id/turn — echo guard', () => {
  it('ignores the agent reply coming back as a prospect turn', async () => {
    const token = await seedCall();
    const res = await app.request(`/api/calls/${CALL_ID}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Call-Token': token },
      body: JSON.stringify({
        utterance: 'Hey Kevin nice to meet you and are you the owner of the property',
      }),
    });

    expect(res.status).toBe(200);
    const events = parseEvents(await res.text());

    // No sentence: the model was never asked, so the agent says nothing and
    // the microphone goes straight back to the prospect.
    expect(events.map((e) => e.event)).toEqual(['ignored', 'speech-end', 'done']);
    expect(events[0]?.data).toEqual({ reason: 'echo' });
    expect(events[2]?.data).toMatchObject({ stage: 'opening', finished: false });
  });
});
