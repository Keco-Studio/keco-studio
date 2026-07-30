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

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  error?: { message?: string };
}

interface MiniMaxEmbeddingResponse {
  vectors?: number[][] | null;
  base_resp?: { status_code?: number; status_msg?: string };
}

function buildEmbeddingsUrl(provider: EmbeddingProvider): string {
  const base = `${getEmbeddingApiUrl()}/v1/embeddings`;
  const groupId = getMinimaxGroupId();
  if (provider === 'minimax' && groupId) {
    return `${base}?GroupId=${encodeURIComponent(groupId)}`;
  }
  return base;
}

async function requestOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
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
  return sorted.map((row) => row.embedding);
}

async function requestMiniMaxEmbeddings(
  texts: string[],
  type: 'db' | 'query'
): Promise<number[][]> {
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

  return json.vectors;
}

async function requestEmbeddings(
  texts: string[],
  type: 'db' | 'query'
): Promise<number[][]> {
  if (isEmbeddingInCooldown()) {
    throw new EmbeddingError('Embedding API is in rate-limit cooldown.');
  }

  await acquireEmbeddingSlot();

  const provider = resolveEmbeddingProvider();
  try {
    if (provider === 'minimax') {
      return await requestMiniMaxEmbeddings(texts, type);
    }
    return await requestOpenAIEmbeddings(texts);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isRateLimitError(message)) {
      markEmbeddingRateLimited();
    }
    throw e;
  }
}

/**
 * Embed one or more text strings for storage/indexing (MiniMax type=db).
 * Batches automatically. Retries once on transient failure.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const vectors = await requestEmbeddings(batch, 'db');
        results.push(...vectors);
        lastError = null;
        break;
      } catch (e) {
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
export async function embedQuery(text: string): Promise<number[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [vector] = await requestEmbeddings([text], 'query');
      return vector;
    } catch (e) {
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
