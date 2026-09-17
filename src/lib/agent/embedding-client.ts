/**
 * Embeddings client with OpenAI-compatible and MiniMax native providers.
 *
 * MiniMax (embo-01) uses `texts` + `type` (db|query) and returns top-level `vectors`,
 * not OpenAI's `input` + `data[].embedding`.
 */

import {
  EMBEDDING_BATCH_SIZE,
  getEmbeddingApiKey,
  getEmbeddingApiUrl,
  getEmbeddingModel,
  getMinimaxGroupId,
  resolveEmbeddingProvider,
  type EmbeddingProvider,
} from './embedding-config';
import {
  acquireEmbeddingSlot,
  isEmbeddingInCooldown,
  isRateLimitError,
  markEmbeddingRateLimited,
} from './embedding-throttle';
import { outboundFetch } from './outbound-http';
import { randomUUID } from 'node:crypto';
import { normalizeTokenUsage } from '@/lib/ai-usage/normalize';
import type { AiProvider, AiUsageBinding, AiUsageOutcome } from '@/lib/ai-usage/types';

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  usage?: unknown;
  error?: { message?: string };
}

interface MiniMaxEmbeddingResponse {
  vectors?: number[][] | null;
  usage?: unknown;
  base_resp?: { status_code?: number; status_msg?: string };
}

type EmbeddingResponse = { vectors: number[][]; usage?: unknown };

function buildEmbeddingsUrl(provider: EmbeddingProvider): string {
  const base = `${getEmbeddingApiUrl()}/v1/embeddings`;
  const groupId = getMinimaxGroupId();
  if (provider === 'minimax' && groupId) {
    return `${base}?GroupId=${encodeURIComponent(groupId)}`;
  }
  return base;
}

async function requestOpenAIEmbeddings(texts: string[]): Promise<EmbeddingResponse> {
  const apiKey = getEmbeddingApiKey();
  if (!apiKey) {
    throw new EmbeddingError('EMBEDDING_API_KEY (or LLM_API_KEY) is not configured.');
  }

  const dimensions = Number.parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);
  const response = await outboundFetch(buildEmbeddingsUrl('openai'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getEmbeddingModel(),
      input: texts,
      dimensions,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new EmbeddingError(
      `Embedding API error ${response.status}: ${body.slice(0, 200) || response.statusText}`
    );
  }

  const json = (await response.json()) as OpenAIEmbeddingResponse;
  if (!json.data || json.data.length === 0) {
    throw new EmbeddingError(json.error?.message ?? 'Embedding API returned no data.');
  }

  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return { vectors: sorted.map((row) => row.embedding), usage: json.usage };
}

async function requestMiniMaxEmbeddings(
  texts: string[],
  type: 'db' | 'query'
): Promise<EmbeddingResponse> {
  const apiKey = getEmbeddingApiKey();
  if (!apiKey) {
    throw new EmbeddingError('EMBEDDING_API_KEY (or LLM_API_KEY) is not configured.');
  }

  const response = await outboundFetch(buildEmbeddingsUrl('minimax'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getEmbeddingModel(),
      texts,
      type,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new EmbeddingError(
      `Embedding API error ${response.status}: ${body.slice(0, 200) || response.statusText}`
    );
  }

  const json = (await response.json()) as MiniMaxEmbeddingResponse;
  const statusCode = json.base_resp?.status_code ?? 0;
  if (statusCode !== 0) {
    const msg = json.base_resp?.status_msg ?? `MiniMax embedding error ${statusCode}`;
    throw new EmbeddingError(msg);
  }

  if (!json.vectors || json.vectors.length === 0) {
    throw new EmbeddingError('Embedding API returned no vectors.');
  }

  return { vectors: json.vectors, usage: json.usage };
}

async function requestEmbeddings(
  texts: string[],
  type: 'db' | 'query'
): Promise<{ provider: AiProvider; response: EmbeddingResponse }> {
  if (isEmbeddingInCooldown()) {
    throw new EmbeddingError('Embedding API is in rate-limit cooldown.');
  }

  await acquireEmbeddingSlot();

  const provider = resolveEmbeddingProvider();
  try {
    if (provider === 'minimax') {
      return { provider, response: await requestMiniMaxEmbeddings(texts, type) };
    }
    return { provider: 'openai', response: await requestOpenAIEmbeddings(texts) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isRateLimitError(message)) {
      markEmbeddingRateLimited();
    }
    throw e;
  }
}

function embeddingOutcome(error: unknown): AiUsageOutcome {
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted';
  return error instanceof EmbeddingError ? 'provider_error' : 'transport_error';
}

async function recordEmbeddingAttempt(
  usageBinding: AiUsageBinding | undefined,
  batch: string[],
  type: 'db' | 'query',
  provider: AiProvider,
  attempt: number,
  startedAt: string,
  outcome: AiUsageOutcome,
  usage: unknown,
): Promise<void> {
  if (!usageBinding) return;
  try {
    await usageBinding.recorder({
      eventKey: randomUUID(),
      context: usageBinding.context,
      requestKind: 'embedding',
      provider,
      model: getEmbeddingModel(),
      attempt,
      outcome,
      usage: normalizeTokenUsage(usage, 'embedding'),
      startedAt,
      finishedAt: new Date().toISOString(),
      metadata: {
        batchSize: batch.length,
        inputCharacters: batch.reduce((total, text) => total + text.length, 0),
        embeddingType: type === 'query' ? 'query' : 'index_batch',
      },
    });
  } catch {
    // Accounting must not alter embedding availability or retry behavior.
  }
}

/**
 * Embed one or more text strings for storage/indexing (MiniMax type=db).
 * Batches automatically. Retries once on transient failure.
 */
export async function embedTexts(
  texts: string[],
  usageBinding?: AiUsageBinding,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const startedAt = new Date().toISOString();
      try {
        const { provider, response } = await requestEmbeddings(batch, 'db');
        await recordEmbeddingAttempt(
          usageBinding, batch, 'db', provider, attempt + 1, startedAt, 'succeeded', response.usage,
        );
        results.push(...response.vectors);
        lastError = null;
        break;
      } catch (e) {
        await recordEmbeddingAttempt(
          usageBinding, batch, 'db', resolveEmbeddingProvider(), attempt + 1, startedAt,
          embeddingOutcome(e), null,
        );
        lastError = e;
        const message = e instanceof Error ? e.message : String(e);
        if (isRateLimitError(message) || isEmbeddingInCooldown()) {
          break;
        }
        if (attempt === 0) {
          await sleep(300);
        }
      }
    }
    if (lastError) {
      throw lastError instanceof Error ? lastError : new EmbeddingError(String(lastError));
    }
  }

  return results;
}

/** Embed a search query (MiniMax type=query). */
export async function embedQuery(text: string, usageBinding?: AiUsageBinding): Promise<number[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = new Date().toISOString();
    try {
      const { provider, response } = await requestEmbeddings([text], 'query');
      await recordEmbeddingAttempt(
        usageBinding, [text], 'query', provider, attempt + 1, startedAt, 'succeeded', response.usage,
      );
      const [vector] = response.vectors;
      return vector;
    } catch (e) {
      await recordEmbeddingAttempt(
        usageBinding, [text], 'query', resolveEmbeddingProvider(), attempt + 1, startedAt,
        embeddingOutcome(e), null,
      );
      lastError = e;
      const message = e instanceof Error ? e.message : String(e);
      if (isRateLimitError(message) || isEmbeddingInCooldown()) {
        break;
      }
      if (attempt === 0) {
        await sleep(300);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new EmbeddingError(String(lastError));
}
