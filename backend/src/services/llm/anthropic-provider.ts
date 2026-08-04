/**
 * Anthropic-shaped LLM provider.
 *
 * Used for GLM (decision D9). The GLM Coding Plan key only works through
 * `POST {baseUrl}/v1/messages` with an `x-api-key` header — the OpenAI-style
 * `/api/paas/v4` path returns 429 without pay-as-you-go credit. Verified
 * 2026-08-05.
 *
 * Written against the wire format directly rather than the Anthropic SDK: GLM
 * only implements a subset, and hand-rolling keeps the dependency surface small
 * and the failure modes visible.
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

export interface AnthropicProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  extractorModel: string;
  anthropicVersion: string;
  timeoutMs: number;
  defaultTemperature: number;
  defaultMaxTokens: number;
  keepAlive: boolean;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  usage?: AnthropicUsage;
}

/**
 * Combines the caller's abort signal with a timeout.
 * Returns the signal plus a cleanup function that must always run, or the
 * timer leaks for the length of the timeout.
 */
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

export function createAnthropicProvider(config: AnthropicProviderConfig): LlmProvider {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/v1/messages`;

  const headers = (): Record<string, string> => ({
    'x-api-key': config.apiKey,
    'anthropic-version': config.anthropicVersion,
    'content-type': 'application/json',
    // The GLM API is China-hosted; the TLS handshake measured ~0.32s from the
    // US. Reusing the connection pays that once per process, not once per turn.
    ...(config.keepAlive ? { connection: 'keep-alive' } : {}),
  });

  async function post(
    body: unknown,
    signal: AbortSignal,
    timedOut: () => boolean,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
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
      // Read the body for server-side diagnostics only — it can contain
      // provider-specific detail that must not reach the caller.
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
        system: options.system,
        messages: options.messages,
        stream: true,
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

          // SSE frames are separated by a blank line; a frame may hold
          // multiple `data:` lines. Keep the trailing partial in the buffer.
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;

              let event: Record<string, unknown>;
              try {
                event = JSON.parse(payload) as Record<string, unknown>;
              } catch {
                continue; // Ignore malformed frames rather than killing the turn.
              }

              const type = event['type'];

              if (type === 'content_block_delta') {
                const delta = event['delta'] as { type?: string; text?: string } | undefined;
                // Ignore `thinking_delta`: reasoning is not speech.
                if (delta?.type === 'text_delta' && delta.text) yield delta.text;
              } else if (type === 'message_start') {
                const message = event['message'] as { usage?: AnthropicUsage } | undefined;
                totals.inputTokens += message?.usage?.input_tokens ?? 0;
              } else if (type === 'message_delta') {
                const u = event['usage'] as AnthropicUsage | undefined;
                totals.outputTokens += u?.output_tokens ?? 0;
              }
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

    try {
      const response = await post(
        {
          model: config.extractorModel,
          max_tokens: options.maxTokens ?? 800,
          // Deterministic: this call produces state, not conversation.
          temperature: 0,
          system: options.system,
          messages: options.messages,
          // Forced tool use — verified working on glm-4.5-flash. This is the
          // capability the Kimi Code endpoint refused, and why R4 is retired.
          tool_choice: { type: 'tool', name: options.toolName },
          tools: [
            {
              name: options.toolName,
              description: options.toolDescription,
              input_schema: options.schema,
            },
          ],
        },
        signal,
        timedOut,
      );

      const json = (await response.json()) as AnthropicMessageResponse;
      const toolUse = json.content?.find((block) => block.type === 'tool_use');

      if (!toolUse || toolUse.input === undefined) {
        throw llmError('The model did not return a structured result', {
          provider: config.name,
          toolName: options.toolName,
        });
      }

      return {
        data: options.parse(toolUse.input),
        usage: {
          inputTokens: json.usage?.input_tokens ?? 0,
          outputTokens: json.usage?.output_tokens ?? 0,
        },
      };
    } finally {
      cleanup();
    }
  }

  async function ping(external?: AbortSignal): Promise<{ ok: true; latencyMs: number }> {
    const startedAt = Date.now();
    // Short, independent budget: health checks must fail fast, not hang for the
    // full conversational timeout.
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
