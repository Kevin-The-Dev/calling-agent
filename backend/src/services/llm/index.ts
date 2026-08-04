/**
 * LLM provider factory.
 *
 * Reads `LLM_PROVIDER` and returns the matching implementation. This is the
 * only place that knows which vendor is in play — see implementation.md D9.
 */
import type { Env } from '../../lib/env.js';
import { createAnthropicProvider } from './anthropic-provider.js';
import { createOpenAiProvider } from './openai-provider.js';
import type { LlmProvider } from './types.js';

export type { LlmProvider, LlmMessage, StreamTextResult, ExtractResult } from './types.js';

/** Groq and Gemini are wired but not yet selected — see implementation.md R14. */
const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export function createLlmProvider(env: Env): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case 'glm': {
      // Validated in env.ts via superRefine; assert for the type narrowing.
      const apiKey = env.GLM_API_KEY!;
      const baseUrl = env.GLM_BASE_URL!;

      if (env.GLM_API_STYLE === 'openai') {
        return createOpenAiProvider({
          name: 'glm',
          apiKey,
          baseUrl,
          model: env.GLM_MODEL,
          extractorModel: env.GLM_EXTRACTOR_MODEL,
          timeoutMs: env.LLM_TIMEOUT_MS,
          defaultTemperature: env.LLM_TEMPERATURE,
          defaultMaxTokens: env.LLM_MAX_TOKENS,
        });
      }

      return createAnthropicProvider({
        name: 'glm',
        apiKey,
        baseUrl,
        model: env.GLM_MODEL,
        extractorModel: env.GLM_EXTRACTOR_MODEL,
        anthropicVersion: env.GLM_ANTHROPIC_VERSION,
        timeoutMs: env.LLM_TIMEOUT_MS,
        defaultTemperature: env.LLM_TEMPERATURE,
        defaultMaxTokens: env.LLM_MAX_TOKENS,
        keepAlive: env.GLM_KEEPALIVE,
      });
    }

    case 'kimi':
      return createOpenAiProvider({
        name: 'kimi',
        apiKey: env.KIMI_API_KEY!,
        baseUrl: env.KIMI_BASE_URL!,
        model: env.KIMI_MODEL ?? 'kimi-for-coding',
        extractorModel: env.KIMI_MODEL ?? 'kimi-for-coding',
        timeoutMs: env.LLM_TIMEOUT_MS,
        defaultTemperature: env.LLM_TEMPERATURE,
        defaultMaxTokens: env.LLM_MAX_TOKENS,
        // Kimi's coding endpoint rejects a forced tool_choice while thinking is
        // enabled, and thinking cannot be disabled there. JSON mode works.
        useJsonModeForExtraction: true,
      });

    case 'groq':
      return createOpenAiProvider({
        name: 'groq',
        apiKey: env.GROQ_API_KEY!,
        baseUrl: env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
        model: env.GROQ_MODEL ?? GROQ_DEFAULT_MODEL,
        extractorModel: env.GROQ_MODEL ?? GROQ_DEFAULT_MODEL,
        timeoutMs: env.LLM_TIMEOUT_MS,
        defaultTemperature: env.LLM_TEMPERATURE,
        defaultMaxTokens: env.LLM_MAX_TOKENS,
      });

    case 'gemini':
      // Gemini's OpenAI-compatibility layer speaks the same shape.
      return createOpenAiProvider({
        name: 'gemini',
        apiKey: env.GEMINI_API_KEY!,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: env.GEMINI_MODEL ?? 'gemini-2.5-flash',
        extractorModel: env.GEMINI_MODEL ?? 'gemini-2.5-flash',
        timeoutMs: env.LLM_TIMEOUT_MS,
        defaultTemperature: env.LLM_TEMPERATURE,
        defaultMaxTokens: env.LLM_MAX_TOKENS,
      });
  }
}
