/**
 * OpenAI-shaped LLM provider.
 *
 * Covers Kimi, Groq, and GLM's pay-as-you-go endpoint — anything exposing
 * `POST {baseUrl}/chat/completions` with a bearer token.
 *
 * Not the MVP path (D9 selects the Anthropic-shaped GLM endpoint), but kept
 * complete and tested so switching providers is genuinely a config change and
 * not a rewrite under deadline.
 */
import { llmError, llmTimeout } from '../../lib/errors.js';
import type {
  ExtractOptions,
  ExtractResult,
  LlmProvider,
  StreamTextOptions,
  StreamTextResult,
  TokenUsage,
} from './types.js';

export interface OpenAiProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  extractorModel: string;
  timeoutMs: number;
  defaultTemperature: number;
  defaultMaxTokens: number;
  /**
   * Some reasoning models reject a forced `tool_choice`. When true, the
   * extractor uses JSON mode instead of tool calling. (Kimi's coding endpoint
   * needs this; GLM does not.)
   */
  useJsonModeForExtraction?: boolean;
  /**
   * Extra fields merged into every request body — provider-specific switches
   * such as OpenRouter's `reasoning` and `provider` routing objects.
   */
  extraBody?: Record<string, unknown>;
  /** Extra headers sent with every request. */
  extraHeaders?: Record<string, string>;
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface OpenAiChoiceMessage {
  content?: string | null;
  tool_calls?: { function?: { name?: string; arguments?: string } }[];
}

interface OpenAiResponse {
  choices?: { message?: OpenAiChoiceMessage }[];
  usage?: OpenAiUsage;
}

function withTimeout(timeoutMs: number, external?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onExternalAbort = () => controller.abort(external?.reason);

  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    },
    timedOut: () => controller.signal.aborted && !external?.aborted,
  };
}

export function createOpenAiProvider(config: OpenAiProviderConfig): LlmProvider {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  async function post(
    body: unknown,
    signal: AbortSignal,
    timedOut: () => boolean,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...config.extraHeaders,
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        // The request's own fields win over the extras, so a provider switch
        // can never overwrite the model, the messages, or the tool choice.
        body: JSON.stringify({ ...config.extraBody, ...(body as Record<string, unknown>) }),
        signal,
      });
    } catch (err) {
      if (timedOut()) throw llmTimeout();
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw llmError('Could not reach the language model', {
        provider: config.name,
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw llmError('The language model rejected the request', {
        provider: config.name,
        status: response.status,
        body: detail.slice(0, 500),
      });
    }

    return response;
  }

  async function streamText(options: StreamTextOptions): Promise<StreamTextResult> {
    const { signal, cleanup, timedOut } = withTimeout(config.timeoutMs, options.signal);

    const response = await post(
      {
        model: config.model,
        max_tokens: options.maxTokens ?? config.defaultMaxTokens,
        temperature: options.temperature ?? config.defaultTemperature,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: options.system },
          ...options.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      },
      signal,
      timedOut,
    ).catch((err: unknown) => {
      cleanup();
      throw err;
    });

    const body = response.body;
    if (!body) {
      cleanup();
      throw llmError('The language model returned an empty stream', { provider: config.name });
    }

    let resolveUsage: (usage: TokenUsage) => void;
    const usage = new Promise<TokenUsage>((resolve) => {
      resolveUsage = resolve;
    });

    async function* iterate(): AsyncGenerator<string> {
      const reader = body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const totals: TokenUsage = { inputTokens: 0, outputTokens: 0 };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;

            let event: OpenAiResponse & {
              choices?: { delta?: { content?: string | null } }[];
            };
            try {
              event = JSON.parse(payload) as typeof event;
            } catch {
              continue;
            }

            const text = event.choices?.[0]?.delta?.content;
            if (text) yield text;

            if (event.usage) {
              totals.inputTokens = event.usage.prompt_tokens ?? totals.inputTokens;
              totals.outputTokens = event.usage.completion_tokens ?? totals.outputTokens;
            }
          }
        }
      } finally {
        reader.releaseLock();
        cleanup();
        resolveUsage(totals);
      }
    }

    return { chunks: iterate(), usage };
  }

  async function extract<T>(options: ExtractOptions<T>): Promise<ExtractResult<T>> {
    const { signal, cleanup, timedOut } = withTimeout(config.timeoutMs, options.signal);

    const messages = [
      { role: 'system' as const, content: options.system },
      ...options.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      const body = config.useJsonModeForExtraction
        ? {
            model: config.extractorModel,
            max_tokens: options.maxTokens ?? 800,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages,
          }
        : {
            model: config.extractorModel,
            max_tokens: options.maxTokens ?? 800,
            temperature: 0,
            tool_choice: { type: 'function', function: { name: options.toolName } },
            tools: [
              {
                type: 'function',
                function: {
                  name: options.toolName,
                  description: options.toolDescription,
                  parameters: options.schema,
                },
              },
            ],
            messages,
          };

      const response = await post(body, signal, timedOut);
      const json = (await response.json()) as OpenAiResponse;
      const message = json.choices?.[0]?.message;

      const rawJson = config.useJsonModeForExtraction
        ? message?.content
        : message?.tool_calls?.[0]?.function?.arguments;

      if (!rawJson) {
        throw llmError('The model did not return a structured result', {
          provider: config.name,
          toolName: options.toolName,
        });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        throw llmError('The model returned malformed JSON', { provider: config.name });
      }

      return {
        data: options.parse(parsed),
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
        },
      };
    } finally {
      cleanup();
    }
  }

  async function ping(external?: AbortSignal): Promise<{ ok: true; latencyMs: number }> {
    const startedAt = Date.now();
    const { signal, cleanup, timedOut } = withTimeout(Math.min(config.timeoutMs, 8000), external);

    try {
      const response = await post(
        { model: config.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
        signal,
        timedOut,
      );
      await response.arrayBuffer();
      return { ok: true, latencyMs: Date.now() - startedAt };
    } finally {
      cleanup();
    }
  }

  return { name: config.name, model: config.model, streamText, extract, ping };
}
