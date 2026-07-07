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

const LLM_BASE = (process.env.LLM_API_URL || 'https://api.minimax.io').replace(/\/+$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'MiniMax-M3';

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

interface StreamLlmOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: OpenAITool[];
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function requestStream(
  messages: ChatMessage[],
  options: StreamLlmOptions
): Promise<Response> {
  if (!LLM_API_KEY) {
    throw new LlmError('LLM_API_KEY is not configured.');
  }

  const body: Record<string, unknown> = {
    model: LLM_MODEL,
    messages,
    temperature: options.temperature ?? 0.3,
    stream: true,
  };
  if (options.maxTokens != null) {
    body.max_tokens = options.maxTokens;
  }
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
    // v1: one tool call per turn keeps the ReAct loop simple.
    body.parallel_tool_calls = false;
  }

  return fetch(`${LLM_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
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

  // Retry once on transient errors before any chunk is consumed.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await requestStream(messages, options);
      if (response.ok && response.body) break;

      const retriable = isRetriableStatus(response.status);
      if (!retriable || attempt === 1) {
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
      if (attempt === 1) throw err;
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
  for await (const chunk of streamLlm(messages, options)) {
    if (chunk.type === 'text_delta') text += chunk.content;
  }
  return text;
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
