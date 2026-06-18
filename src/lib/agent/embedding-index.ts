/**
 * Embedding index pipeline — upsert, delete, and async reindex triggers.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cellDisplayString } from '@/lib/utils/assetEmptiness';
import { getMessageText } from './content-parts';
import { parseStoredContent } from './conversation-store';
import {
  buildChatTurnGroups,
  buildLibraryCellChunkText,
  chunkDesignDocument,
  formatChatTurnGroupText,
  getTailTurnGroups,
  hashContent,
  isDesignDocumentMessage,
  isIndexableLibraryFieldType,
  type ChatTurnGroup,
  type IndexableChatMessage,
} from './chunking';
import { embedTexts } from './embedding-client';
import { AGENT_CHAT_REINDEX_DEBOUNCE_MS, AGENT_INDEXING_ENABLED } from './embedding-config';
import { isEmbeddingInCooldown } from './embedding-throttle';

const MIN_CHAT_CHUNK_CHARS = 20;
const MIN_LIBRARY_CHUNK_CHARS = 10;
const LIBRARY_REINDEX_DEBOUNCE_MS = 2000;

interface ChunkUpsertRow {
  project_id: string;
  user_id: string | null;
  source_type: 'chat_message' | 'library_cell' | 'design_document';
  source_id: string;
  conversation_id: string | null;
  chunk_index: number;
  content: string;
  content_hash: string;
  metadata: Record<string, unknown>;
  embedding: number[];
}

const pendingLibraryReindex = new Map<string, ReturnType<typeof setTimeout>>();
const pendingChatReindex = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightChatReindex = new Set<string>();

function logIndex(event: string, detail: Record<string, unknown>): void {
  console.info(`embedding.index.${event}`, detail);
}

function logIndexError(event: string, detail: Record<string, unknown>): void {
  console.error(`embedding.index.${event}`, detail);
}

async function upsertChunks(supabase: SupabaseClient, rows: ChunkUpsertRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('agent_embedding_chunks').upsert(
    rows.map((r) => ({
      ...r,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'source_type,source_id,chunk_index,content_hash' }
  );
  if (error) throw new Error(error.message);
}

async function deleteStaleChunksForSource(
  supabase: SupabaseClient,
  sourceType: ChunkUpsertRow['source_type'],
  sourceIdPrefix: string,
  keepChunkIndexes: number[]
): Promise<void> {
  const { data, error } = await supabase
    .from('agent_embedding_chunks')
    .select('id, source_id, chunk_index')
    .eq('source_type', sourceType)
    .like('source_id', `${sourceIdPrefix}%`);
  if (error || !data) return;

  const keep = new Set(keepChunkIndexes);
  const toDelete = data.filter((row) => {
    const idx = row.chunk_index as number;
    const sid = row.source_id as string;
    return sid.startsWith(sourceIdPrefix) && !keep.has(idx);
  });
  if (toDelete.length === 0) return;
  await supabase
    .from('agent_embedding_chunks')
    .delete()
    .in('id', toDelete.map((r) => r.id as string));
}

export async function loadIndexableChatMessages(
  supabase: SupabaseClient,
  conversationId: string
): Promise<IndexableChatMessage[]> {
  const { data, error } = await supabase
    .from('agent_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true });
  if (error || !data) return [];

  const out: IndexableChatMessage[] = [];
  for (const row of data) {
    const body = (row.content ?? {}) as Record<string, unknown>;
    const text = getMessageText(parseStoredContent(body.content));
    if (!text.trim()) continue;
    out.push({
      id: row.id as string,
      role: row.role as 'user' | 'assistant',
      text,
      createdAt: row.created_at as string,
    });
  }
  return out;
}

async function indexChatTurnGroup(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    conversationId: string;
    group: ChatTurnGroup;
  },
  embedding?: number[]
): Promise<void> {
  const content = formatChatTurnGroupText(params.group.messages);
  if (content.length < MIN_CHAT_CHUNK_CHARS) return;

  const contentHash = hashContent(content);
  const sourceId = `${params.conversationId}:turn_group:${params.group.chunkIndex}`;

  const { data: existing } = await supabase
    .from('agent_embedding_chunks')
    .select('id, content_hash')
    .eq('source_type', 'chat_message')
    .eq('source_id', sourceId)
    .eq('chunk_index', params.group.chunkIndex)
    .maybeSingle();
  if (existing && (existing.content_hash as string) === contentHash) return;

  await supabase
    .from('agent_embedding_chunks')
    .delete()
    .eq('source_type', 'chat_message')
    .eq('source_id', sourceId)
    .eq('chunk_index', params.group.chunkIndex);

  const vector = embedding ?? (await embedTexts([content]))[0];
  await upsertChunks(supabase, [
    {
      project_id: params.projectId,
      user_id: params.userId,
      source_type: 'chat_message',
      source_id: sourceId,
      conversation_id: params.conversationId,
      chunk_index: params.group.chunkIndex,
      content,
      content_hash: contentHash,
      metadata: {
        conversationId: params.conversationId,
        messageIds: params.group.messageIds,
        messageCount: params.group.messageIds.length,
        firstMessageAt: params.group.firstMessageAt,
        lastMessageAt: params.group.lastMessageAt,
      },
      embedding: vector,
    },
  ]);
}

export async function reindexConversationTail(
  supabase: SupabaseClient,
  params: { conversationId: string; projectId: string; userId: string }
): Promise<void> {
  if (!AGENT_INDEXING_ENABLED) return;
  if (isEmbeddingInCooldown()) {
    logIndex('chat_message.skipped', {
      conversationId: params.conversationId,
      reason: 'rate_limit_cooldown',
    });
    return;
  }
  if (inFlightChatReindex.has(params.conversationId)) return;

  inFlightChatReindex.add(params.conversationId);
  const start = Date.now();
  try {
    const messages = await loadIndexableChatMessages(supabase, params.conversationId);
    const tailGroups = getTailTurnGroups(messages, 2);
    const allGroups = buildChatTurnGroups(messages);
    const tailIndexes = new Set(tailGroups.map((g) => g.chunkIndex));

    const pending: Array<{
      group: ChatTurnGroup;
      content: string;
      contentHash: string;
    }> = [];

    for (const group of tailGroups) {
      const content = formatChatTurnGroupText(group.messages);
      if (content.length < MIN_CHAT_CHUNK_CHARS) continue;

      const contentHash = hashContent(content);
      const sourceId = `${params.conversationId}:turn_group:${group.chunkIndex}`;
      const { data: existing } = await supabase
        .from('agent_embedding_chunks')
        .select('content_hash')
        .eq('source_type', 'chat_message')
        .eq('source_id', sourceId)
        .eq('chunk_index', group.chunkIndex)
        .maybeSingle();
      if (existing && (existing.content_hash as string) === contentHash) continue;
      pending.push({ group, content, contentHash });
    }

    if (pending.length > 0) {
      const embeddings = await embedTexts(pending.map((item) => item.content));
      for (let i = 0; i < pending.length; i++) {
        await indexChatTurnGroup(supabase, { ...params, group: pending[i].group }, embeddings[i]);
      }
    }

    for (const group of allGroups) {
      if (!tailIndexes.has(group.chunkIndex)) continue;
      const sourceId = `${params.conversationId}:turn_group:${group.chunkIndex}`;
      await deleteStaleChunksForSource(supabase, 'chat_message', sourceId, [group.chunkIndex]);
    }

    logIndex('chat_message', {
      conversationId: params.conversationId,
      chunkCount: tailGroups.length,
      embeddedCount: pending.length,
      durationMs: Date.now() - start,
    });
  } catch (e) {
    logIndexError('chat_message', {
      conversationId: params.conversationId,
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    inFlightChatReindex.delete(params.conversationId);
  }
}

export function scheduleConversationTailReindex(
  supabase: SupabaseClient,
  params: { conversationId: string; projectId: string; userId: string }
): void {
  if (!AGENT_INDEXING_ENABLED) return;
  const key = params.conversationId;
  const existing = pendingChatReindex.get(key);
  if (existing) clearTimeout(existing);
  pendingChatReindex.set(
    key,
    setTimeout(() => {
      pendingChatReindex.delete(key);
      void reindexConversationTail(supabase, params);
    }, AGENT_CHAT_REINDEX_DEBOUNCE_MS)
  );
}

export async function indexDesignDocumentFromMessage(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    conversationId: string;
    messageId: string;
    messageText: string;
    messageCreatedAt: string;
  }
): Promise<void> {
  if (!AGENT_INDEXING_ENABLED || !isDesignDocumentMessage(params.messageText)) return;
  const start = Date.now();
  try {
    const docChunks = chunkDesignDocument(params.messageText);
    if (docChunks.length === 0) return;

    const texts = docChunks.map((c) => c.content);
    const embeddings = await embedTexts(texts);
    const rows: ChunkUpsertRow[] = docChunks.map((chunk, i) => ({
      project_id: params.projectId,
      user_id: params.userId,
      source_type: 'design_document',
      source_id: `${params.conversationId}:${params.messageId}:chunk:${chunk.chunkIndex}`,
      conversation_id: params.conversationId,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      content_hash: hashContent(chunk.content),
      metadata: {
        conversationId: params.conversationId,
        messageId: params.messageId,
        chunkIndex: chunk.chunkIndex,
        chunkHeading: chunk.chunkHeading,
        messageCreatedAt: params.messageCreatedAt,
      },
      embedding: embeddings[i],
    }));

    await upsertChunks(supabase, rows);
    const prefix = `${params.conversationId}:${params.messageId}:chunk:`;
    await deleteStaleChunksForSource(
      supabase,
      'design_document',
      prefix,
      docChunks.map((c) => c.chunkIndex)
    );

    logIndex('design_document', {
      conversationId: params.conversationId,
      messageId: params.messageId,
      chunkCount: docChunks.length,
      durationMs: Date.now() - start,
    });
  } catch (e) {
    logIndexError('design_document', {
      conversationId: params.conversationId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function indexLibraryCell(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    assetId: string;
    fieldId: string;
  }
): Promise<void> {
  if (!AGENT_INDEXING_ENABLED) return;
  const start = Date.now();
  const sourceId = `${params.assetId}:${params.fieldId}`;

  try {
    // library_asset_values has no updated_at column; the asset row carries the
    // most recent edit timestamp, so we read value_json here and fall back to
    // library_assets.updated_at for the chunk metadata below.
    const { data: cell, error: cellErr } = await supabase
      .from('library_asset_values')
      .select('value_json')
      .eq('asset_id', params.assetId)
      .eq('field_id', params.fieldId)
      .maybeSingle();

    if (cellErr) throw new Error(cellErr.message);

    if (!cell) {
      await supabase
        .from('agent_embedding_chunks')
        .delete()
        .eq('source_type', 'library_cell')
        .eq('source_id', sourceId);
      return;
    }

    const { data: asset } = await supabase
      .from('library_assets')
      .select('id, name, library_id, updated_at')
      .eq('id', params.assetId)
      .single();
    if (!asset) return;

    const { data: library } = await supabase
      .from('libraries')
      .select('id, name, project_id')
      .eq('id', asset.library_id)
      .single();
    if (!library || library.project_id !== params.projectId) return;

    const { data: field } = await supabase
      .from('library_field_definitions')
      .select('id, label, data_type, section')
      .eq('id', params.fieldId)
      .single();
    if (!field || !isIndexableLibraryFieldType(field.data_type as string)) return;

    const cellText = cellDisplayString(cell.value_json);
    if (cellText.trim().length < MIN_LIBRARY_CHUNK_CHARS) {
      await supabase
        .from('agent_embedding_chunks')
        .delete()
        .eq('source_type', 'library_cell')
        .eq('source_id', sourceId);
      return;
    }

    const content = buildLibraryCellChunkText(
      library.name as string,
      asset.name as string,
      (field.label as string) || 'field',
      cellText
    );
    const contentHash = hashContent(content);

    const { data: existing } = await supabase
      .from('agent_embedding_chunks')
      .select('id, content_hash')
      .eq('source_type', 'library_cell')
      .eq('source_id', sourceId)
      .eq('chunk_index', 0)
      .maybeSingle();
    if (existing && (existing.content_hash as string) === contentHash) return;

    await supabase
      .from('agent_embedding_chunks')
      .delete()
      .eq('source_type', 'library_cell')
      .eq('source_id', sourceId)
      .eq('chunk_index', 0);

    const [embedding] = await embedTexts([content]);
    await upsertChunks(supabase, [
      {
        project_id: params.projectId,
        user_id: null,
        source_type: 'library_cell',
        source_id: sourceId,
        conversation_id: null,
        chunk_index: 0,
        content,
        content_hash: contentHash,
        metadata: {
          libraryId: library.id,
          libraryName: library.name,
          assetId: asset.id,
          assetName: asset.name,
          fieldId: field.id,
          fieldLabel: field.label,
          sectionId: `${library.id}:${field.section ?? ''}`,
          cellUpdatedAt: asset.updated_at,
        },
        embedding,
      },
    ]);

    logIndex('library_cell', {
      sourceId,
      durationMs: Date.now() - start,
    });
  } catch (e) {
    logIndexError('library_cell', {
      sourceId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export function scheduleLibraryCellReindex(
  supabase: SupabaseClient,
  params: { projectId: string; assetId: string; fieldId: string }
): void {
  if (!AGENT_INDEXING_ENABLED) return;
  const key = `${params.projectId}:${params.assetId}:${params.fieldId}`;
  const existing = pendingLibraryReindex.get(key);
  if (existing) clearTimeout(existing);
  pendingLibraryReindex.set(
    key,
    setTimeout(() => {
      pendingLibraryReindex.delete(key);
      void indexLibraryCell(supabase, params).catch((e) =>
        logIndexError('library_cell', { key, error: e instanceof Error ? e.message : String(e) })
      );
    }, LIBRARY_REINDEX_DEBOUNCE_MS)
  );
}

export async function reindexProjectLibraryCells(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ indexed: number; skipped: number }> {
  const { data: libraries } = await supabase
    .from('libraries')
    .select('id')
    .eq('project_id', projectId);
  if (!libraries?.length) return { indexed: 0, skipped: 0 };

  let indexed = 0;
  let skipped = 0;
  for (const lib of libraries) {
    const { data: assets } = await supabase
      .from('library_assets')
      .select('id')
      .eq('library_id', lib.id);
    if (!assets?.length) continue;

    for (const asset of assets) {
      const { data: cells } = await supabase
        .from('library_asset_values')
        .select('field_id')
        .eq('asset_id', asset.id);
      if (!cells?.length) continue;
      for (const cell of cells) {
        try {
          await indexLibraryCell(supabase, {
            projectId,
            assetId: asset.id as string,
            fieldId: cell.field_id as string,
          });
          indexed++;
        } catch {
          skipped++;
        }
      }
    }
  }
  return { indexed, skipped };
}

export async function reindexProjectConversations(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ conversations: number }> {
  const { data: conversations } = await supabase
    .from('agent_conversations')
    .select('id, user_id')
    .eq('project_id', projectId);
  if (!conversations?.length) return { conversations: 0 };

  for (const conv of conversations) {
    const messages = await loadIndexableChatMessages(supabase, conv.id as string);
    const groups = buildChatTurnGroups(messages);
    for (const group of groups) {
      await indexChatTurnGroup(supabase, {
        projectId,
        userId: conv.user_id as string,
        conversationId: conv.id as string,
        group,
      });
    }
  }
  return { conversations: conversations.length };
}

export function scheduleReindexForAssetFields(
  supabase: SupabaseClient,
  projectId: string,
  assetId: string,
  fieldIds: string[]
): void {
  for (const fieldId of fieldIds) {
    scheduleLibraryCellReindex(supabase, { projectId, assetId, fieldId });
  }
}

export function triggerConversationIndexing(
  supabase: SupabaseClient,
  params: {
    conversationId: string;
    projectId: string;
    userId: string;
    role: string;
    messageText?: string;
    messageId?: string;
    messageCreatedAt?: string;
  }
): void {
  if (!AGENT_INDEXING_ENABLED) return;
  if (params.role === 'user' || params.role === 'assistant') {
    scheduleConversationTailReindex(supabase, {
      conversationId: params.conversationId,
      projectId: params.projectId,
      userId: params.userId,
    });
  }
  if (
    params.role === 'user' &&
    params.messageText &&
    params.messageId &&
    params.messageCreatedAt &&
    isDesignDocumentMessage(params.messageText)
  ) {
    void indexDesignDocumentFromMessage(supabase, {
      projectId: params.projectId,
      userId: params.userId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      messageText: params.messageText,
      messageCreatedAt: params.messageCreatedAt,
    });
  }
}
