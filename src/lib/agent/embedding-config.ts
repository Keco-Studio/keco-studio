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
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = parseIntEnv('EMBEDDING_DIMENSIONS', 1536);
export const EMBEDDING_BATCH_SIZE = parseIntEnv('EMBEDDING_BATCH_SIZE', 64);

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
