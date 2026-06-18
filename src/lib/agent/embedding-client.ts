/**
 * OpenAI-compatible embeddings client for agent vector memory / RAG.
 */

import {
  EMBEDDING_BATCH_SIZE,
} from './embedding-config';

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface EmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  error?: { message?: string };
}

async function requestEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY || '';
  const apiUrl = (
    process.env.EMBEDDING_API_URL ||
    process.env.LLM_API_URL ||
    'https://api.minimax.io'
  ).replace(/\/+$/, '');
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const dimensions = Number.parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);

  if (!apiKey) {
    throw new EmbeddingError('EMBEDDING_API_KEY (or LLM_API_KEY) is not configured.');
  }

  const response = await fetch(`${apiUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
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

  const json = (await response.json()) as EmbeddingResponse;
  if (!json.data || json.data.length === 0) {
    throw new EmbeddingError(json.error?.message ?? 'Embedding API returned no data.');
  }

  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return sorted.map((row) => row.embedding);
}

/**
 * Embed one or more text strings. Batches automatically (max 64 per request).
 * Retries once on transient failure.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const vectors = await requestEmbeddings(batch);
        results.push(...vectors);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
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

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}
