import { createHash } from 'node:crypto';

const CACHE_VERSION = 'story-ir-conversion-v1';
const MAX_ENTRIES = 8;
const TTL_MS = 10 * 60 * 1000;

type CompletedEntry<T> = {
  value: T;
  expiresAt: number;
};

const completed = new Map<string, CompletedEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export async function getOrResolveStory<T>(
  sourceText: string,
  resolver: (sourceText: string) => Promise<T>,
  options: { variant?: string } = {}
): Promise<{ value: T; cacheHit: boolean }> {
  const key = cacheKey(sourceText, options.variant ?? 'default');
  const now = Date.now();
  const cached = completed.get(key);
  if (cached) {
    if (cached.expiresAt > now) {
      // Refresh insertion order so active entries stay in the bounded cache.
      completed.delete(key);
      completed.set(key, cached);
      return { value: cached.value as T, cacheHit: true };
    }
    completed.delete(key);
  }

  const pending = inFlight.get(key);
  if (pending) {
    return {
      value: await pending as T,
      cacheHit: true,
    };
  }

  const promise = Promise.resolve()
    .then(() => resolver(sourceText))
    .then((value) => {
      inFlight.delete(key);
      completed.set(key, { value, expiresAt: Date.now() + TTL_MS });
      evictOldestEntries();
      return value;
    }, (error: unknown) => {
      inFlight.delete(key);
      throw error;
    });
  inFlight.set(key, promise);

  return {
    value: await promise,
    cacheHit: false,
  };
}

export function resetStoryConversionCache(): void {
  completed.clear();
  inFlight.clear();
}

function cacheKey(sourceText: string, variant: string): string {
  return createHash('sha256')
    .update(CACHE_VERSION, 'utf8')
    .update('\0', 'utf8')
    .update(variant, 'utf8')
    .update('\0', 'utf8')
    .update(sourceText, 'utf8')
    .digest('hex');
}

function evictOldestEntries(): void {
  while (completed.size > MAX_ENTRIES) {
    const oldest = completed.keys().next().value;
    if (oldest === undefined) return;
    completed.delete(oldest);
  }
}
