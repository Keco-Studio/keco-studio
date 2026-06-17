/**
 * Conversation + message persistence. The DB is the single source of truth for
 * agent state; the ReAct loop reloads history from here on every turn.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatContentPart, ChatMessage, ConversationMeta } from './types';
import { metaForSave, resolveConversationMeta } from './conversation-meta';

/** True when a value is a well-formed multimodal content-part array. */
function isContentPartArray(value: unknown): value is ChatContentPart[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (part) =>
        part != null &&
        typeof part === 'object' &&
        typeof (part as { type?: unknown }).type === 'string'
    )
  );
}

/**
 * Reconstruct a persisted message body into `ChatMessage['content']`.
 *
 * - string -> string (legacy/plain text, backward compatible).
 * - content-part array -> restored verbatim (multimodal user messages).
 * - null/undefined -> empty string.
 * - any other object -> JSON string (legacy fallback).
 */
export function parseStoredContent(stored: unknown): ChatMessage['content'] {
  if (typeof stored === 'string') return stored;
  if (stored == null) return '';
  if (isContentPartArray(stored)) return stored;
  return JSON.stringify(stored);
}

export interface ConversationRecord {
  id: string;
  user_id: string;
  project_id: string;
  title: string | null;
  meta: ConversationMeta;
  created_at: string;
  updated_at: string;
}

/**
 * Resolve an existing conversation (validating ownership) or create a new one
 * bound to the user + project.
 */
export async function getOrCreateConversation(
  supabase: SupabaseClient,
  params: { conversationId?: string; userId: string; projectId: string; initialAutoExecute?: boolean }
): Promise<ConversationRecord> {
  if (params.conversationId) {
    const { data, error } = await supabase
      .from('agent_conversations')
      .select('*')
      .eq('id', params.conversationId)
      .single();
    if (error || !data) {
      throw new Error('Conversation not found.');
    }
    if (data.user_id !== params.userId) {
      throw new Error('Conversation does not belong to the current user.');
    }
    return normalizeConversation(data);
  }

  const initialMeta = metaForSave(params.initialAutoExecute ?? true);

  const { data, error } = await supabase
    .from('agent_conversations')
    .insert({ user_id: params.userId, project_id: params.projectId, meta: initialMeta })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`Failed to create conversation: ${error?.message ?? 'unknown error'}`);
  }
  return normalizeConversation(data);
}

export async function getConversation(
  supabase: SupabaseClient,
  conversationId: string
): Promise<ConversationRecord | null> {
  const { data, error } = await supabase
    .from('agent_conversations')
    .select('*')
    .eq('id', conversationId)
    .single();
  if (error || !data) return null;
  return normalizeConversation(data);
}

/**
 * Load the full message history of a conversation, reconstructed as
 * OpenAI-compatible ChatMessage[] suitable for feeding to the LLM.
 */
export async function loadConversationHistory(
  supabase: SupabaseClient,
  conversationId: string
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];

  return sanitizeMessagesForLlm(
    data.map((row) => {
      const body = (row.content ?? {}) as Record<string, unknown>;
      const message: ChatMessage = {
        role: row.role as ChatMessage['role'],
        content: parseStoredContent(body.content),
      };
      if (Array.isArray(body.tool_calls)) message.tool_calls = body.tool_calls as ChatMessage['tool_calls'];
      if (typeof body.tool_call_id === 'string') message.tool_call_id = body.tool_call_id;
      if (typeof body.name === 'string') message.name = body.name;
      return message;
    })
  );
}

/**
 * LLM providers (MiniMax, OpenAI-compatible) require every assistant message with tool_calls to be
 * immediately followed by a tool message per tool_call_id. Repair gaps left by
 * interrupted confirmation flows or partial DB writes.
 */
export function sanitizeMessagesForLlm(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const ids = msg.tool_calls.map((tc) => tc.id);
      const toolById = new Map<string, ChatMessage>();
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') {
        const tid = messages[j].tool_call_id;
        if (tid) toolById.set(tid, messages[j]);
        j++;
      }

      const missing = ids.filter((id) => !toolById.has(id));
      out.push(msg);

      for (const id of ids) {
        const existing = toolById.get(id);
        if (existing) {
          out.push(existing);
        } else if (missing.includes(id)) {
          out.push({
            role: 'tool',
            tool_call_id: id,
            content: JSON.stringify({
              success: false,
              error: 'Tool result was not recorded (interrupted session).',
            }),
          });
        }
      }

      i = j;
      continue;
    }

    out.push(msg);
    i++;
  }

  return out;
}

/**
 * Persist a single message. The content jsonb stores the full message body so
 * tool_calls / tool_call_id survive round-trips.
 */
export async function saveMessage(
  supabase: SupabaseClient,
  conversationId: string,
  message: ChatMessage
): Promise<void> {
  const content: Record<string, unknown> = { content: message.content ?? '' };
  if (message.tool_calls) content.tool_calls = message.tool_calls;
  if (message.tool_call_id) content.tool_call_id = message.tool_call_id;
  if (message.name) content.name = message.name;

  const { error } = await supabase.from('agent_messages').insert({
    conversation_id: conversationId,
    role: message.role,
    content,
  });
  if (error) {
    throw new Error(`Failed to save message: ${error.message}`);
  }
  await touchConversation(supabase, conversationId);
}

export async function touchConversation(
  supabase: SupabaseClient,
  conversationId: string,
  patch?: Partial<Pick<ConversationRecord, 'title'>>
): Promise<void> {
  await supabase
    .from('agent_conversations')
    .update({ updated_at: new Date().toISOString(), ...(patch ?? {}) })
    .eq('id', conversationId);
}

export async function updateConversationMeta(
  supabase: SupabaseClient,
  conversationId: string,
  meta: ConversationMeta
): Promise<ConversationMeta> {
  const resolved = resolveConversationMeta(meta);
  const toSave = metaForSave(resolved.autoExecute !== false);
  const { error } = await supabase
    .from('agent_conversations')
    .update({ meta: toSave, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) {
    throw new Error(`Failed to update conversation meta: ${error.message}`);
  }
  return toSave;
}

export interface ConversationListItem {
  id: string;
  projectId: string;
  projectName: string;
  meta: ConversationMeta;
  title: string | null;
  lastMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listConversations(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<ConversationListItem[]> {
  const { data, error } = await supabase
    .from('agent_conversations')
    .select('id, meta, title, created_at, updated_at, project_id, projects(name)')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error || !data) return [];

  return data.map((row) => mapConversationListRow(row));
}

export async function listAllConversations(
  supabase: SupabaseClient,
  userId: string
): Promise<ConversationListItem[]> {
  const { data, error } = await supabase
    .from('agent_conversations')
    .select('id, meta, title, created_at, updated_at, project_id, projects(name)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error || !data) return [];

  return data.map((row) => mapConversationListRow(row));
}

function mapConversationListRow(row: Record<string, unknown>): ConversationListItem {
  const projects = row.projects as { name?: string } | { name?: string }[] | null | undefined;
  const projectName = Array.isArray(projects)
    ? (projects[0]?.name ?? 'Unknown project')
    : (projects?.name ?? 'Unknown project');

  return {
    id: row.id as string,
    projectId: row.project_id as string,
    projectName,
    meta: resolveConversationMeta((row.meta ?? {}) as ConversationMeta),
    title: (row.title as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function deleteConversation(
  supabase: SupabaseClient,
  conversationId: string
): Promise<void> {
  const { error } = await supabase.from('agent_conversations').delete().eq('id', conversationId);
  if (error) {
    throw new Error(`Failed to delete conversation: ${error.message}`);
  }
}

export interface MessagePage {
  messages: Array<{ id: string; role: string; content: unknown; createdAt: string }>;
  nextCursor?: string;
}

export async function getMessages(
  supabase: SupabaseClient,
  conversationId: string,
  options: { cursor?: string; limit?: number } = {}
): Promise<MessagePage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  let query = supabase
    .from('agent_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit + 1);
  if (options.cursor) {
    query = query.gt('created_at', options.cursor);
  }

  const { data, error } = await query;
  if (error || !data) return { messages: [] };

  const hasMore = data.length > limit;
  const page = hasMore ? data.slice(0, limit) : data;
  return {
    messages: page.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    })),
    nextCursor: hasMore ? page[page.length - 1].created_at : undefined,
  };
}

function normalizeConversation(row: Record<string, unknown>): ConversationRecord {
  const rawMeta = (row.meta ?? {}) as ConversationMeta;
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    project_id: row.project_id as string,
    title: (row.title as string | null) ?? null,
    meta: resolveConversationMeta(rawMeta),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
