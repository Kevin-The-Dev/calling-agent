/**
 * OpenRouter wiring: the switches that make a thinking model usable on a live
 * call must actually reach the wire, on every kind of request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeModel, parseEnv } from '../src/lib/env.js';
import { createLlmProvider, openRouterBody } from '../src/services/llm/index.js';

const BASE = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-value',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value',
  CALL_TOKEN_SECRET: 'a'.repeat(64),
  LOG_LEVEL: 'error',
  LLM_PROVIDER: 'openrouter',
};

afterEach(() => vi.unstubAllGlobals());

/** Captures every request the provider makes and answers with `reply`. */
function captureFetch(reply: () => Response) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return reply();
    }),
  );
  return calls;
}

describe('OpenRouter configuration', () => {
  it('refuses to boot without a key', () => {
    expect(() => parseEnv(BASE)).toThrow(/OPENROUTER_API_KEY/);
  });

  it('defaults to DeepSeek V4 Flash with thinking off and the fastest host', () => {
    const env = parseEnv({ ...BASE, OPENROUTER_API_KEY: 'sk-or-test' });
    expect(activeModel(env)).toBe('deepseek/deepseek-v4-flash');
    expect(openRouterBody(env)).toEqual({
      reasoning: { effort: 'none', exclude: true },
      provider: { sort: 'latency', require_parameters: true },
    });
  });

  it('leaves reasoning to the model when asked to', () => {
    const env = parseEnv({ ...BASE, OPENROUTER_API_KEY: 'sk-or-test', OPENROUTER_REASONING: 'default' });
    expect(openRouterBody(env)).not.toHaveProperty('reasoning');
  });
});

describe('OpenRouter requests', () => {
  const env = parseEnv({
    ...BASE,
    OPENROUTER_API_KEY: 'sk-or-test',
    OPENROUTER_EXTRACTOR_MODEL: 'openai/gpt-4.1-nano',
  });

  it('sends the switches with a streamed reply, without touching model or messages', async () => {
    const calls = captureFetch(
      () =>
        new Response('data: {"choices":[{"delta":{"content":"Hi there."}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
        }),
    );
    const provider = createLlmProvider(env);
    const stream = await provider.streamText({
      system: 'be brief',
      messages: [{ role: 'user', content: 'hello' }],
    });
    let text = '';
    for await (const chunk of stream.chunks) text += chunk;

    expect(text).toBe('Hi there.');
    const [call] = calls;
    expect(call?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call?.headers['authorization']).toBe('Bearer sk-or-test');
    expect(call?.body).toMatchObject({
      model: 'deepseek/deepseek-v4-flash',
      stream: true,
      reasoning: { effort: 'none', exclude: true },
      provider: { sort: 'latency', require_parameters: true },
    });
    expect((call?.body['messages'] as unknown[]).length).toBe(2);
  });

  it('sends them with the extraction call too, on the extractor model', async () => {
    const calls = captureFetch(() =>
      Response.json({
        choices: [
          { message: { tool_calls: [{ function: { name: 'record', arguments: '{"ok":true}' } }] } },
        ],
      }),
    );
    const provider = createLlmProvider(env);
    const result = await provider.extract({
      system: 'extract',
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object', properties: {} },
      toolName: 'record',
      toolDescription: 'record it',
      parse: (raw) => raw as { ok: boolean },
    });

    expect(result.data).toEqual({ ok: true });
    expect(calls[0]?.body).toMatchObject({
      model: 'openai/gpt-4.1-nano',
      tool_choice: { type: 'function', function: { name: 'record' } },
      reasoning: { effort: 'none', exclude: true },
    });
  });
});
