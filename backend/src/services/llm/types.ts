/**
 * LLM provider interface.
 *
 * The turn engine talks only to this interface. Swapping GLM for Groq, Gemini,
 * or Kimi must never require a change above this layer — that indirection is
 * what makes decision D9 (and any future reversal of it) a config change.
 *
 * Two capabilities, deliberately separate, matching the two-call design in
 * implementation.md §1.3:
 *
 *   streamText()  — what the agent SAYS. On the critical path. Streamed so the
 *                   first sentence can reach text-to-speech while the rest is
 *                   still generating.
 *   extract()     — structured state update. Off the critical path, temperature
 *                   0, schema-validated.
 */

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamTextOptions {
  /** System prompt — persona, stage instructions, lead state. */
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Aborts the in-flight request — used for barge-in. */
  signal?: AbortSignal;
}

export interface ExtractOptions<T> {
  system: string;
  messages: LlmMessage[];
  /** JSON Schema describing the object to extract. */
  schema: JsonSchemaObject;
  /** Name the model sees for the extraction tool. */
  toolName: string;
  toolDescription: string;
  /** Validates and narrows the model's raw output. Throws on mismatch. */
  parse: (raw: unknown) => T;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StreamTextResult {
  /** Yields text fragments in order, as they arrive. */
  chunks: AsyncIterable<string>;
  /** Resolves once the stream completes. */
  usage: Promise<TokenUsage>;
}

export interface ExtractResult<T> {
  data: T;
  usage: TokenUsage;
}

export interface LlmProvider {
  readonly name: string;
  /** Model used for spoken replies. */
  readonly model: string;

  streamText(options: StreamTextOptions): Promise<StreamTextResult>;
  extract<T>(options: ExtractOptions<T>): Promise<ExtractResult<T>>;
  /** Cheap liveness probe for the health endpoint. */
  ping(signal?: AbortSignal): Promise<{ ok: true; latencyMs: number }>;
}
