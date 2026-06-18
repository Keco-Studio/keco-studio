import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { embedTexts, EmbeddingError } from '../../../src/lib/agent/embedding-client';

describe('embedTexts', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.EMBEDDING_API_KEY = 'test-key';
    process.env.EMBEDDING_API_URL = 'https://embed.test';
    process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
    process.env.EMBEDDING_DIMENSIONS = '3';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns empty array for no inputs', async () => {
    await expect(embedTexts([])).resolves.toEqual([]);
  });

  it('calls embeddings API and returns vectors', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { embedding: [0.1, 0.2, 0.3], index: 0 },
            { embedding: [0.4, 0.5, 0.6], index: 1 },
          ],
        }),
        { status: 200 }
      )
    ) as typeof fetch;

    const vectors = await embedTexts(['hello', 'world']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toEqual([0.1, 0.2, 0.3]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on transient failure', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response('server error', { status: 500 });
      }
      return new Response(
        JSON.stringify({ data: [{ embedding: [1, 0, 0], index: 0 }] }),
        { status: 200 }
      );
    }) as typeof fetch;

    const vectors = await embedTexts(['retry me']);
    expect(vectors[0]).toEqual([1, 0, 0]);
    expect(calls).toBe(2);
  });

  it('throws EmbeddingError when API key missing', async () => {
    process.env.EMBEDDING_API_KEY = '';
    process.env.LLM_API_KEY = '';
    await expect(embedTexts(['x'])).rejects.toBeInstanceOf(EmbeddingError);
  });
});
