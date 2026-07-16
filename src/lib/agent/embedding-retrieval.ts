/**
 * Retrieval ranking, scope quotas, RPC fetch, and prompt formatting for vector RAG.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RetrievalScope } from './embedding-config';
import {
  AGENT_RETRIEVAL_MAX_CHARS,
  AGENT_RETRIEVAL_MIN_SCORE,
  AGENT_RETRIEVAL_RECENCY_WEIGHT,
  RECENCY_HALF_LIFE_DAYS,
  SCOPE_QUOTAS,
} from './embedding-config';

export interface RetrievalCandidate {
  id: string;
  sourceType: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  sourceTimestamp: string;
  scope: RetrievalScope;
  finalScore?: number;
}

export interface RankedRetrievalCandidate extends RetrievalCandidate {
  finalScore: number;
}

const CHAT_CONFLICT_SCORE_DELTA = 0.05;
const LIBRARY_ROW_CELL_SCORE_DELTA = 0.08;

export function computeRecencyScore(
  sourceTimestamp: string,
  halfLifeDays: number,
  now: Date = new Date()
): number {
  const ageMs = now.getTime() - new Date(sourceTimestamp).getTime();
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
  return Math.exp(-ageDays / halfLifeDays);
}

export function computeFinalScore(
  similarity: number,
  recencyScore: number,
  recencyWeight = AGENT_RETRIEVAL_RECENCY_WEIGHT
): number {
  return similarity * (1 - recencyWeight) + recencyScore * recencyWeight;
}

export function rankCandidates(
  candidates: RetrievalCandidate[],
  now: Date = new Date()
): RankedRetrievalCandidate[] {
  const ranked = candidates.map((c) => {
    const halfLife = RECENCY_HALF_LIFE_DAYS[c.sourceType] ?? 60;
    const recency = computeRecencyScore(c.sourceTimestamp, halfLife, now);
    return {
      ...c,
      finalScore: computeFinalScore(c.similarity, recency),
    };
  });
  return resolveChatConflict(dedupeLibraryRowOverCell(ranked)).sort((a, b) => b.finalScore - a.finalScore);
}

/** Prefer library_row over library_cell for the same asset unless the cell scores much higher. */
export function dedupeLibraryRowOverCell(
  candidates: RankedRetrievalCandidate[]
): RankedRetrievalCandidate[] {
  const rowByAsset = new Map<string, RankedRetrievalCandidate>();
  for (const c of candidates) {
    if (c.sourceType !== 'library_row') continue;
    const assetId = String(c.metadata.assetId ?? '');
    if (assetId) rowByAsset.set(assetId, c);
  }
  if (rowByAsset.size === 0) return candidates;

  return candidates.filter((c) => {
    if (c.sourceType !== 'library_cell') return true;
    const assetId = String(c.metadata.assetId ?? '');
    const row = rowByAsset.get(assetId);
    if (!row) return true;
    return c.finalScore - row.finalScore > LIBRARY_ROW_CELL_SCORE_DELTA;
  });
}

export function resolveChatConflict(
  candidates: RankedRetrievalCandidate[]
): RankedRetrievalCandidate[] {
  const chatByConversation = new Map<string, RankedRetrievalCandidate[]>();
  const nonChat: RankedRetrievalCandidate[] = [];

  for (const c of candidates) {
    if (c.sourceType !== 'chat_message') {
      nonChat.push(c);
      continue;
    }
    const convId = String(c.metadata.conversationId ?? '');
    if (!convId) {
      nonChat.push(c);
      continue;
    }
    const list = chatByConversation.get(convId) ?? [];
    list.push(c);
    chatByConversation.set(convId, list);
  }

  const resolvedChat: RankedRetrievalCandidate[] = [];
  for (const group of chatByConversation.values()) {
    if (group.length < 2) {
      resolvedChat.push(...group);
      continue;
    }
    const sorted = [...group].sort((a, b) => b.finalScore - a.finalScore);
    const top = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const other = sorted[i];
      if (Math.abs(top.finalScore - other.finalScore) < CHAT_CONFLICT_SCORE_DELTA) {
        const topTs = String(top.metadata.lastMessageAt ?? top.sourceTimestamp);
        const otherTs = String(other.metadata.lastMessageAt ?? other.sourceTimestamp);
        if (new Date(otherTs).getTime() > new Date(topTs).getTime()) {
          sorted[0] = other;
        }
      }
    }
    resolvedChat.push(...sorted);
  }

  return [...nonChat, ...resolvedChat];
}

export function applyScopeQuotas(
  ranked: RankedRetrievalCandidate[],
  quotas: Record<RetrievalScope, number> = SCOPE_QUOTAS
): RankedRetrievalCandidate[] {
  const byScope = new Map<RetrievalScope, RankedRetrievalCandidate[]>();
  for (const c of ranked) {
    const list = byScope.get(c.scope) ?? [];
    list.push(c);
    byScope.set(c.scope, list);
  }

  const selected: RankedRetrievalCandidate[] = [];
  for (const [scope, quota] of Object.entries(quotas) as Array<[RetrievalScope, number]>) {
    const scopeItems = (byScope.get(scope) ?? [])
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, quota);
    selected.push(...scopeItems);
  }
  return mergeRetrievalCandidates(selected);
}

export function mergeRetrievalCandidates(
  candidates: RankedRetrievalCandidate[]
): RankedRetrievalCandidate[] {
  return [...candidates].sort((a, b) => b.finalScore - a.finalScore);
}

export function truncateByMaxChars(
  candidates: RankedRetrievalCandidate[],
  maxChars = AGENT_RETRIEVAL_MAX_CHARS
): RankedRetrievalCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.finalScore - a.finalScore);
  let total = 0;
  const kept: RankedRetrievalCandidate[] = [];

  for (const c of sorted) {
    const next = total + c.content.length;
    if (kept.length > 0 && next > maxChars) continue;
    if (kept.length === 0 && c.content.length > maxChars) {
      kept.push({ ...c, content: c.content.slice(0, maxChars) });
      break;
    }
    kept.push(c);
    total = next;
    if (total >= maxChars) break;
  }

  return kept.sort((a, b) => b.finalScore - a.finalScore);
}

function formatSnippetLine(index: number, c: RankedRetrievalCandidate): string {
  const meta = c.metadata;
  if (c.sourceType === 'chat_message') {
    const conv = String(meta.conversationId ?? 'unknown').slice(0, 8);
    const count = meta.messageCount ?? '?';
    const updated = String(meta.lastMessageAt ?? c.sourceTimestamp).slice(0, 10);
    return `${index}. [chat_message · conversation ${conv} · last updated ${updated}] (${count} messages) ${c.content}`;
  }
  if (c.sourceType === 'library_cell') {
    const lib = meta.libraryName ?? 'library';
    const asset = meta.assetName ?? 'asset';
    const field = meta.fieldLabel ?? 'field';
    const updated = String(meta.cellUpdatedAt ?? c.sourceTimestamp).slice(0, 10);
    const rowSuffix =
      typeof meta.rowIndex === 'number' ? ` · row ${meta.rowIndex}` : '';
    return `${index}. [library_cell · ${lib} · ${asset}${rowSuffix} · ${field} · updated ${updated}] ${c.content}`;
  }
  if (c.sourceType === 'library_row') {
    const lib = meta.libraryName ?? 'library';
    const rowIndex = meta.rowIndex ?? '?';
    const label = meta.primaryLabel || meta.assetName || 'row';
    const updated = String(meta.cellUpdatedAt ?? c.sourceTimestamp).slice(0, 10);
    return `${index}. [library_row · ${lib} · row ${rowIndex} · ${label} · updated ${updated}] ${c.content}`;
  }
  if (c.sourceType === 'library_schema') {
    const lib = meta.libraryName ?? 'library';
    const cols = meta.columnCount ?? '?';
    const updated = String(meta.schemaUpdatedAt ?? c.sourceTimestamp).slice(0, 10);
    return `${index}. [library_schema · ${lib} · ${cols} columns · updated ${updated}] ${c.content}`;
  }
  if (c.sourceType === 'design_document') {
    const chunkIdx = meta.chunkIndex ?? c.metadata.chunkIndex ?? 0;
    const updated = String(meta.messageCreatedAt ?? c.sourceTimestamp).slice(0, 10);
    const heading = meta.chunkHeading ? ` · ${meta.chunkHeading}` : '';
    return `${index}. [design_document · chunk ${Number(chunkIdx) + 1}${heading} · ${updated}] ${c.content}`;
  }
  if (c.sourceType === 'project_document') {
    const name = String(meta.documentName ?? 'document');
    const folder = meta.folderName ? ` · folder ${String(meta.folderName)}` : ' · project root';
    const heading = meta.heading ? ` · ${String(meta.heading)}` : '';
    const startLine = Number(meta.startLine);
    const endLine = Number(meta.endLine);
    const range = Number.isFinite(startLine) && Number.isFinite(endLine)
      ? ` · lines ${startLine}-${endLine}`
      : '';
    const documentId = String(meta.documentId ?? 'unknown');
    const updated = String(meta.documentUpdatedAt ?? c.sourceTimestamp).slice(0, 10);
    return `${index}. [project_document · ${name}${folder}${heading}${range} · document ${documentId} · updated ${updated}] ${c.content}`;
  }
  return `${index}. [${c.sourceType}] ${c.content}`;
}

export function formatRetrievedContext(candidates: RankedRetrievalCandidate[]): string {
  if (candidates.length === 0) return '';

  const lines = candidates.map((c, i) => formatSnippetLine(i + 1, c));
  return [
    '## Retrieved context (semantic search — may be incomplete)',
    'The following snippets were retrieved by similarity search. They supplement recent chat history; they are NOT guaranteed complete. Prefer fresh tool results for factual data.',
    '',
    ...lines,
    '',
    'If retrieved context conflicts with tool results or the user\'s latest message, trust tools and the latest message.',
    'When multiple chat snippets disagree, prefer the snippet with the **most recent timestamp** (newer decisions override older ones).',
  ].join('\n');
}

export { AGENT_RETRIEVAL_MIN_SCORE, AGENT_RETRIEVAL_MAX_CHARS, SCOPE_QUOTAS };

export interface RetrieveChunksParams {
  supabase: SupabaseClient;
  queryEmbedding: number[];
  projectId: string;
  userId: string;
  conversationId: string;
  scopeQuotas?: Record<RetrievalScope, number>;
  minScore?: number;
  maxChars?: number;
  scopes?: RetrievalScope[];
}

interface RpcMatchRow {
  id: string;
  source_type: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
  source_timestamp: string;
}

async function fetchScopeCandidates(
  supabase: SupabaseClient,
  params: RetrieveChunksParams,
  scope: RetrievalScope,
  matchCount: number
): Promise<RetrievalCandidate[]> {
  const { data, error } = await supabase.rpc('match_agent_embedding_chunks', {
    p_query_embedding: params.queryEmbedding,
    p_project_id: params.projectId,
    p_user_id: params.userId,
    p_conversation_id: params.conversationId,
    p_scope: scope,
    p_match_count: matchCount,
    p_min_score: params.minScore ?? AGENT_RETRIEVAL_MIN_SCORE,
  });
  if (error || !data) {
    console.warn('embedding.retrieve.rpc_error', { scope, error: error?.message });
    return [];
  }

  return (data as RpcMatchRow[]).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    content: row.content,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    similarity: row.similarity,
    sourceTimestamp: row.source_timestamp,
    scope,
  }));
}

export async function retrieveRelevantChunks(
  params: RetrieveChunksParams
): Promise<RankedRetrievalCandidate[]> {
  const quotas = params.scopeQuotas ?? SCOPE_QUOTAS;
  const scopes = params.scopes ?? (Object.keys(quotas) as RetrievalScope[]);
  const candidates: RetrievalCandidate[] = [];

  for (const scope of scopes) {
    const quota = quotas[scope] ?? 0;
    if (quota <= 0) continue;
    const scopeCandidates = await fetchScopeCandidates(
      params.supabase,
      params,
      scope,
      quota * 2
    );
    candidates.push(...scopeCandidates);
  }

  const ranked = rankCandidates(candidates);
  const quotaApplied = applyScopeQuotas(ranked, quotas);
  return truncateByMaxChars(quotaApplied, params.maxChars ?? AGENT_RETRIEVAL_MAX_CHARS);
}

export interface SemanticSearchParams {
  supabase: SupabaseClient;
  queryEmbedding: number[];
  projectId: string;
  userId: string;
  conversationId: string;
  scope?: 'chat' | 'library' | 'design_document' | 'project_document' | 'all';
  libraryName?: string;
  limit?: number;
  minScore?: number;
}

export async function semanticSearchChunks(
  params: SemanticSearchParams
): Promise<RankedRetrievalCandidate[]> {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 20);
  let scopes: RetrievalScope[];
  switch (params.scope ?? 'all') {
    case 'chat':
      scopes = ['chat_same_conversation', 'chat_same_project'];
      break;
    case 'library':
      scopes = ['library'];
      break;
    case 'design_document':
      scopes = ['design_document'];
      break;
    case 'project_document':
      scopes = ['project_document'];
      break;
    default:
      scopes = ['chat_same_conversation', 'chat_same_project', 'library', 'design_document', 'project_document'];
  }

  const customQuotas = Object.fromEntries(
    scopes.map((s) => [s, limit])
  ) as Record<RetrievalScope, number>;

  let results = await retrieveRelevantChunks({
    supabase: params.supabase,
    queryEmbedding: params.queryEmbedding,
    projectId: params.projectId,
    userId: params.userId,
    conversationId: params.conversationId,
    scopeQuotas: customQuotas,
    minScore: params.minScore ?? AGENT_RETRIEVAL_MIN_SCORE,
    maxChars: Number.MAX_SAFE_INTEGER,
    scopes,
  });

  if (params.libraryName) {
    const needle = params.libraryName.toLowerCase();
    const libraryTypes = new Set(['library_cell', 'library_row', 'library_schema']);
    results = results.filter(
      (r) =>
        !libraryTypes.has(r.sourceType) ||
        String(r.metadata.libraryName ?? '').toLowerCase().includes(needle)
    );
  }

  return results.slice(0, limit);
}
