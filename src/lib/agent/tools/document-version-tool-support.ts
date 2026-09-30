import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthoritativeDocumentTransportState } from '@/lib/documents/documentStateTypes';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import type { ToolContext } from '../types';

export const documentIdSchema = z.string().uuid();

export async function requireScopedDocument(ctx: ToolContext, projectId: string, documentId: string, write = false) {
  const { data, error } = await ctx.supabase.from('documents')
    .select('id,project_id,name')
    .eq('id', documentId)
    .eq('project_id', projectId)
    .single();
  if (error || !data || data.project_id !== projectId) throw new Error('Document not found in this project.');
  const { role } = await getUserProjectRole(ctx.supabase, projectId, ctx.userId);
  if (write && role === 'viewer') throw new Error('This document requires admin or editor access.');
  return { id: String(data.id), name: String(data.name) };
}

export async function versionDocumentState(ctx: ToolContext, projectId: string, documentId: string) {
  const { documentStateGateway } = await import('@/lib/documents/documentStateGateway');
  const state = await documentStateGateway.readTransport(ctx.supabase, documentId);
  if (state.projectId !== projectId || state.documentId !== documentId) {
    throw new Error('Document not found in this project.');
  }
  return state;
}

export function documentStateFingerprint(state: AuthoritativeDocumentTransportState): string {
  return createHash('sha256').update(JSON.stringify({
    token: state.token,
    yjsStateBase64: state.yjsStateBase64,
    updateTail: state.updateTail.map((update) => ({ id: update.id, updateBase64: update.updateBase64 })),
    updatedAt: state.updatedAt,
  })).digest('hex');
}
