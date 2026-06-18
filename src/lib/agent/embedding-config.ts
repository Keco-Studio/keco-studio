/**
 * Environment configuration for agent vector memory / RAG.
 */

const parseIntEnv = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

const parseFloatEnv = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
};

const parseBoolEnv = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key];
  if (raw == null || raw.trim() === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
};

export const EMBEDDING_API_URL = (
  process.env.EMBEDDING_API_URL ||
  process.env.LLM_API_URL ||
  'https://api.minimax.io'
).replace(/\/+$/, '');

export const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY || '';
export const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID || '';

export function getEmbeddingApiKey(): string {
  return process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY || '';
}

export function getEmbeddingApiUrl(): string {
  return (
    process.env.EMBEDDING_API_URL ||
    process.env.LLM_API_URL ||
    'https://api.minimax.io'
  ).replace(/\/+$/, '');
}

export function getMinimaxGroupId(): string {
  return process.env.MINIMAX_GROUP_ID || '';
}

export type EmbeddingProvider = 'openai' | 'minimax';

/** Explicit override; otherwise inferred from URL/model (see resolveEmbeddingProvider). */
export const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || '').toLowerCase();

export function resolveEmbeddingProvider(): EmbeddingProvider {
  const explicit = (process.env.EMBEDDING_PROVIDER || '').toLowerCase();
  if (explicit === 'minimax') return 'minimax';
  if (explicit === 'openai') return 'openai';

  const model = (process.env.EMBEDDING_MODEL || '').toLowerCase();
  if (model.includes('embo')) return 'minimax';

  const url = getEmbeddingApiUrl().toLowerCase();
  if (url.includes('minimax') || url.includes('minimaxi')) return 'minimax';

  return 'openai';
}

const defaultEmbeddingModel = (): string =>
  resolveEmbeddingProvider() === 'minimax' ? 'embo-01' : 'text-embedding-3-small';

/** Resolved at call time so tests and runtime env changes apply. */
export function getEmbeddingModel(): string {
  const explicit = process.env.EMBEDDING_MODEL?.trim();
  return explicit || defaultEmbeddingModel();
}

/** @deprecated Prefer getEmbeddingModel() — frozen at module load in some bundlers. */
export const EMBEDDING_MODEL = getEmbeddingModel();
export const EMBEDDING_DIMENSIONS = parseIntEnv('EMBEDDING_DIMENSIONS', 1536);
export const EMBEDDING_BATCH_SIZE = parseIntEnv('EMBEDDING_BATCH_SIZE', 64);
export const EMBEDDING_MIN_INTERVAL_MS = parseIntEnv('EMBEDDING_MIN_INTERVAL_MS', -1);
export const EMBEDDING_RATE_LIMIT_COOLDOWN_MS = parseIntEnv('EMBEDDING_RATE_LIMIT_COOLDOWN_MS', 60_000);
export const AGENT_CHAT_REINDEX_DEBOUNCE_MS = parseIntEnv('AGENT_CHAT_REINDEX_DEBOUNCE_MS', 8000);

/** Pacing between embedding HTTP calls; -1 = auto (1.5s for MiniMax, 0 for OpenAI). */
export function getEmbeddingMinIntervalMs(): number {
  if (EMBEDDING_MIN_INTERVAL_MS >= 0) return EMBEDDING_MIN_INTERVAL_MS;
  return resolveEmbeddingProvider() === 'minimax' ? 1500 : 0;
}

export function getEmbeddingRateLimitCooldownMs(): number {
  return EMBEDDING_RATE_LIMIT_COOLDOWN_MS;
}

export const AGENT_INDEXING_ENABLED = parseBoolEnv('AGENT_INDEXING_ENABLED', true);
export const AGENT_RETRIEVAL_ENABLED = parseBoolEnv('AGENT_RETRIEVAL_ENABLED', true);
export const AGENT_RETRIEVAL_MIN_SCORE = parseFloatEnv('AGENT_RETRIEVAL_MIN_SCORE', 0.72);
export const AGENT_RETRIEVAL_MAX_CHARS = parseIntEnv('AGENT_RETRIEVAL_MAX_CHARS', 32000);
export const AGENT_RETRIEVAL_RECENCY_WEIGHT = parseFloatEnv('AGENT_RETRIEVAL_RECENCY_WEIGHT', 0.2);
export const AGENT_DESIGN_DOC_VECTOR_ONLY = parseBoolEnv('AGENT_DESIGN_DOC_VECTOR_ONLY', false);

export const AGENT_CHAT_TURN_GROUP_MAX_MESSAGES = parseIntEnv('AGENT_CHAT_TURN_GROUP_MAX_MESSAGES', 5);
export const AGENT_CHAT_TURN_GROUP_MIN_MESSAGES = parseIntEnv('AGENT_CHAT_TURN_GROUP_MIN_MESSAGES', 3);
export const AGENT_CHAT_TURN_GROUP_GAP_MINUTES = parseIntEnv('AGENT_CHAT_TURN_GROUP_GAP_MINUTES', 30);
export const AGENT_CHAT_LONG_MESSAGE_CHARS = parseIntEnv('AGENT_CHAT_LONG_MESSAGE_CHARS', 1500);

export type RetrievalScope =
  | 'chat_same_conversation'
  | 'chat_same_project'
  | 'library'
  | 'design_document';

export const SCOPE_QUOTAS: Record<RetrievalScope, number> = {
  chat_same_conversation: parseIntEnv('AGENT_RETRIEVAL_QUOTA_CHAT_SAME', 3),
  chat_same_project: parseIntEnv('AGENT_RETRIEVAL_QUOTA_CHAT_PROJECT', 2),
  library: parseIntEnv('AGENT_RETRIEVAL_QUOTA_LIBRARY', 4),
  design_document: parseIntEnv('AGENT_RETRIEVAL_QUOTA_DESIGN_DOC', 3),
};

export const RECENCY_HALF_LIFE_DAYS: Record<string, number> = {
  chat_message: parseIntEnv('AGENT_RETRIEVAL_HALF_LIFE_CHAT_DAYS', 30),
  library_cell: parseIntEnv('AGENT_RETRIEVAL_HALF_LIFE_LIBRARY_DAYS', 90),
  design_document: parseIntEnv('AGENT_RETRIEVAL_HALF_LIFE_DESIGN_DOC_DAYS', 60),
};
