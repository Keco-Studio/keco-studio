/**
 * Pending action store — DB as single source of truth for suspended ReAct loops.
 *
 * An in-memory Map acts purely as a cache; on miss we fall back to the DB so the
 * confirmation flow survives server restarts and multi-instance deployments.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfirmationMode, SuspendedState } from './types';

export interface PendingAction {
  id: string;
  conversationId: string;
  toolName: string;
  args: unknown;
  confirmationMode: ConfirmationMode;
  status: 'pending' | 'approved' | 'rejected';
  suspendedState: SuspendedState;
}

interface CachedPendingAction extends PendingAction {
  ownerUserId: string;
  expiresAt?: string;
}

interface PendingActionRow {
  id: string;
  conversation_id: string;
  tool_name: string;
  args: unknown;
  confirmation_mode: ConfirmationMode;
  status: PendingAction['status'];
  suspended_state: SuspendedState;
  expires_at?: string | null;
}

const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;
const memoryCache = new Map<string, CachedPendingAction>();

async function serviceRoleClient(): Promise<SupabaseClient> {
  const { getSupabaseServiceRoleClient } = await import('@/lib/server/supabaseServiceRole');
  return getSupabaseServiceRoleClient();
}

async function actorOwnsConversation(
  supabase: SupabaseClient,
  conversationId: string,
  actorUserId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('agent_conversations')
    .select('user_id')
    .eq('id', conversationId)
    .maybeSingle();
  return !error && data?.user_id === actorUserId;
}

function isUnexpired(expiresAt?: string): boolean {
  return Boolean(expiresAt && new Date(expiresAt).getTime() >= Date.now());
}

function actionFromRow(data: PendingActionRow): CachedPendingAction {
  return {
    id: data.id,
    conversationId: data.conversation_id,
    toolName: data.tool_name,
    args: data.args,
    confirmationMode: data.confirmation_mode,
    status: data.status,
    suspendedState: data.suspended_state as SuspendedState,
    ownerUserId: '',
    expiresAt: data.expires_at ?? undefined,
  };
}

export async function savePendingAction(
  supabase: SupabaseClient,
  action: Omit<PendingAction, 'status'>,
  actorUserId: string
): Promise<void> {
  if (!(await actorOwnsConversation(supabase, action.conversationId, actorUserId))) {
    throw new Error('Unable to save pending action.');
  }
  const admin = await serviceRoleClient();
  const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_MS).toISOString();
  const { error } = await admin.from('agent_pending_actions').insert({
    id: action.id,
    conversation_id: action.conversationId,
    tool_name: action.toolName,
    args: action.args,
    confirmation_mode: action.confirmationMode,
    status: 'pending',
    suspended_state: action.suspendedState,
    expires_at: expiresAt,
  });
  if (error) {
    throw new Error(`Failed to save pending action: ${error.message}`);
  }
  memoryCache.set(action.id, {
    ...action,
    status: 'pending',
    ownerUserId: actorUserId,
    expiresAt,
  });
}

export async function loadPendingAction(
  supabase: SupabaseClient,
  actionId: string,
  actorUserId: string
): Promise<PendingAction | null> {
  const cached = memoryCache.get(actionId);
  if (cached) {
    if (
      cached.ownerUserId !== actorUserId ||
      cached.status !== 'pending' ||
      !isUnexpired(cached.expiresAt)
    ) {
      return null;
    }
    if (!(await actorOwnsConversation(supabase, cached.conversationId, actorUserId))) return null;
    return cached;
  }

  const admin = await serviceRoleClient();
  const { data, error } = await admin
    .from('agent_pending_actions')
    .select('*')
    .eq('id', actionId)
    .maybeSingle();
  if (error || !data) return null;

  if (data.status !== 'pending' || !isUnexpired(data.expires_at)) return null;
  if (!(await actorOwnsConversation(supabase, data.conversation_id, actorUserId))) return null;

  const action = actionFromRow(data);
  action.ownerUserId = actorUserId;
  memoryCache.set(actionId, action);
  return action;
}

export async function consumePendingAction(
  supabase: SupabaseClient,
  actionId: string,
  actorUserId: string,
  status: 'approved' | 'rejected'
): Promise<boolean> {
  const pending = await loadPendingAction(supabase, actionId, actorUserId);
  if (!pending) return false;

  const admin = await serviceRoleClient();
  const { data, error } = await admin
    .from('agent_pending_actions')
    .update({ status })
    .eq('id', actionId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error || !data) {
    const cached = memoryCache.get(actionId);
    if (cached) cached.status = status;
    return false;
  }

  const consumed = actionFromRow(data);
  consumed.ownerUserId = actorUserId;
  memoryCache.set(actionId, consumed);
  return true;
}
