/**
 * LLM streaming client (OpenAI-compatible Chat Completions API).
 *
 * Currently configured for MiniMax M3 (multimodal thinking model). Image parts
 * in user messages are forwarded verbatim as OpenAI-compatible `image_url`
 * content parts.
 * Parses the upstream SSE stream and re-yields normalized StreamChunk values.
 * Includes a single automatic retry with exponential backoff on transient
 * network / 5xx / 429 errors before the first chunk is read.
 */

import type { ChatMessage, OpenAITool, StreamChunk } from './types';
import { ThinkTagParser } from './think-tag-parser';
import { Agent, fetch as undiciFetch } from 'undici';

const LLM_BASE = (process.env.LLM_API_URL || 'https://api.minimax.io').replace(/\/+$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'MiniMax-M3';
let nonStreamingDispatcher: Agent | null = null;

function getNonStreamingDispatcher(): Agent {
  nonStreamingDispatcher ??= new Agent({
    connectTimeout: 30_000,
    headersTimeout: 90_000,
    bodyTimeout: 90_000,
  });
  return nonStreamingDispatcher;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmResponseMetadata {
  status: number;
  requestId?: string;
}

interface StreamLlmOptions {
  temperature?: number;
  maxTokens?: number;
  maxCompletionTokens?: number;
  thinking?: 'adaptive' | 'disabled';
  tools?: OpenAITool[];
  toolName?: string;
  signal?: AbortSignal;
  onResponseMetadata?: (metadata: LlmResponseMetadata) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function buildRequestBody(
  messages: ChatMessage[],
  options: StreamLlmOptions,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: LLM_MODEL,
    messages,
    temperature: options.temperature ?? 0.3,
    stream,
  };
  if (options.maxCompletionTokens != null) {
    body.max_completion_tokens = options.maxCompletionTokens;
  } else if (options.maxTokens != null) {
    body.max_tokens = options.maxTokens;
  }
  if (options.thinking) {
    body.thinking = { type: options.thinking };
  }
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.toolName
      ? { type: 'function', function: { name: options.toolName } }
      : 'auto';
    body.parallel_tool_calls = false;
  }
  return body;
}

function reportResponseMetadata(response: Response, options: StreamLlmOptions): void {
  const requestId = response.headers.get('x-request-id')
    ?? response.headers.get('request-id')
    ?? response.headers.get('x-minimax-request-id')
    ?? undefined;
  options.onResponseMetadata?.({ status: response.status, ...(requestId ? { requestId } : {}) });
}

async function requestStream(
  messages: ChatMessage[],
  options: StreamLlmOptions
): Promise<Response> {
  if (!LLM_API_KEY) {
    throw new LlmError('LLM_API_KEY is not configured.');
  }

  const response = await fetch(`${LLM_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify(buildRequestBody(messages, options, true)),
    signal: options.signal,
  });
  reportResponseMetadata(response, options);
  return response;
}

/**
 * Stream a chat completion from the LLM, yielding normalized chunks.
 */
export async function* streamLlm(
  messages: ChatMessage[],
  options: StreamLlmOptions = {}
): AsyncGenerator<StreamChunk> {
  let response: Response | null = null;
  let lastError: unknown = null;

  // Retry twice on transient errors before any chunk is consumed.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await requestStream(messages, options);
      if (response.ok && response.body) break;

      const retriable = isRetriableStatus(response.status);
      if (!retriable || attempt === 2) {
        const text = await response.text().catch(() => '');
        throw new LlmError(`LLM request failed (${response.status}): ${text.slice(0, 500)}`);
      }
      lastError = new LlmError(`LLM transient error (${response.status})`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (err instanceof LlmError && !`${err.message}`.includes('transient')) {
        // Non-retriable application error — rethrow immediately.
        throw err;
      }
      lastError = err;
      if (attempt === 2) throw err;
    }
    await sleep(500 * (attempt + 1));
  }

  if (!response || !response.body) {
    throw lastError instanceof Error ? lastError : new LlmError('LLM stream unavailable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const thinkParser = new ThinkTagParser();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines; process complete lines.
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const rawLine = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!rawLine.startsWith('data:')) continue;

        const payload = rawLine.slice('data:'.length).trim();
        if (payload === '[DONE]') return;

        let parsed: LlmChunk;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;

        if (delta?.reasoning_content) {
          yield { type: 'reasoning_delta', content: delta.reasoning_content };
        }

        if (delta?.content) {
          for (const piece of thinkParser.feed(delta.content)) {
            if (piece.kind === 'reasoning') {
              yield { type: 'reasoning_delta', content: piece.content };
            } else {
              yield { type: 'text_delta', content: piece.content };
            }
          }
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            yield {
              type: 'tool_call_delta',
              index: tc.index ?? 0,
              id: tc.id,
              name: tc.function?.name,
              arguments: tc.function?.arguments,
            };
          }
        }

        if (choice.finish_reason) {
          yield {
            type: 'finish',
            reason: choice.finish_reason,
            usage: parsed.usage,
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming convenience wrapper used by the import_script LLM conversion
 * step (it needs the full text before parsing, so streaming buys nothing there).
 */
export async function completeLlm(
  messages: ChatMessage[],
  options: StreamLlmOptions = {}
): Promise<string> {
  let text = '';
  let toolArguments = '';
  let selectedToolIndex: number | null = null;
  for await (const chunk of streamLlm(messages, options)) {
    if (chunk.type === 'finish' && chunk.reason === 'abort') {
      throw new LlmError('LLM aborted before completing the response.');
    }
    if (chunk.type === 'text_delta') text += chunk.content;
    if (chunk.type === 'tool_call_delta' && options.toolName) {
      if (chunk.name === options.toolName) selectedToolIndex = chunk.index;
      if (selectedToolIndex === chunk.index && chunk.arguments) {
        toolArguments += chunk.arguments;
      }
    }
  }
  if (options.toolName) {
    if (!toolArguments) {
      const fallback = text.trim();
      if (isPlainJsonObject(fallback)) return fallback;
      throw new LlmError(`LLM did not call required tool ${options.toolName}.`);
    }
    return toolArguments;
  }
  return text;
}

export async function completeLlmNonStreaming(
  messages: ChatMessage[],
  options: StreamLlmOptions = {},
): Promise<string> {
  if (!LLM_API_KEY) throw new LlmError('LLM_API_KEY is not configured.');

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(`${LLM_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify(buildRequestBody(messages, options, false)),
        signal: options.signal,
        dispatcher: getNonStreamingDispatcher(),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = error;
      if (attempt === 2) throw error;
      await sleep(200 * (2 ** attempt));
      continue;
    }

    reportResponseMetadata(response as unknown as Response, options);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = new LlmError(`LLM request failed (${response.status}): ${text.slice(0, 500)}`);
      if (!isRetriableStatus(response.status) || attempt === 2) throw error;
      lastError = error;
      await sleep(200 * (2 ** attempt));
      continue;
    }

    let parsed: LlmCompletion;
    try {
      parsed = await response.json() as LlmCompletion;
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw new LlmError('LLM response was not valid JSON.');
      await sleep(200 * (2 ** attempt));
      continue;
    }

    const choice = parsed.choices?.[0];
    if (!choice?.message) throw new LlmError('LLM response did not contain a completion.');
    if (choice.finish_reason === 'abort') {
      throw new LlmError('LLM aborted before completing the response.');
    }
    const content = typeof choice.message.content === 'string' ? choice.message.content.trim() : '';
    if (options.toolName) {
      const toolCall = choice.message.tool_calls?.find(
        (call) => call.function?.name === options.toolName,
      );
      const args = toolCall?.function?.arguments;
      if (typeof args === 'string' && args.trim()) return args;
      if (isPlainJsonObject(content)) return content;
      throw new LlmError(`LLM did not call required tool ${options.toolName}.`);
    }
    return content;
  }

  throw lastError instanceof Error ? lastError : new LlmError('LLM request failed.');
}

function isPlainJsonObject(value: string): boolean {
  if (!value.startsWith('{') || !value.endsWith('}')) return false;
  try {
    const parsed = JSON.parse(value);
    return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

interface LlmChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface LlmCompletion {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}
