import { z } from 'zod';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { deleteLibrary, updateLibrary } from '@/lib/services/libraryService';
import {
  deleteScriptWorkspaceDocument,
  upsertScriptWorkspaceDocument,
} from '@/lib/script-system/scriptWorkspaceService';
import { requireProjectContext } from '../workspace';
import type { AgentTool, ConfirmationPreparation, ToolContext, ToolResult } from '../types';

const uuid = z.string().uuid();
const documentSchema = z.object({ documentId: uuid, expectedImportedAt: z.string().optional(), expectedName: z.string().optional(), expectedUpdatedAt: z.string().optional() }).strict();
const librarySchema = z.object({ libraryId: uuid, expectedName: z.string().optional(), expectedUpdatedAt: z.string().optional() }).strict();
const renameSchema = librarySchema.extend({ name: z.string().trim().min(1).max(200) });

function failure(error: unknown): ToolResult {
  return { success: false, error: error instanceof Error ? error.message : 'Script workspace operation failed.' };
}

async function requireRole(ctx: ToolContext, minimum: 'editor' | 'admin') {
  const { role } = await getUserProjectRole(ctx.supabase, requireProjectContext(ctx), ctx.userId);
  if (role === 'viewer' || (minimum === 'admin' && role !== 'admin')) {
    throw new Error(`Only ${minimum === 'admin' ? 'admin' : 'admin or editor'} users can perform this action.`);
  }
}

async function document(ctx: ToolContext, documentId: string) {
  const { data, error } = await ctx.supabase.from('documents')
    .select('id,project_id,name,updated_at').eq('id', documentId).maybeSingle();
  if (error) throw error;
  if (!data || data.project_id !== requireProjectContext(ctx)) throw new Error('Document not found in this project.');
  return data as { id: string; project_id: string; name: string; updated_at: string };
}

async function membership(ctx: ToolContext, documentId: string) {
  const { data, error } = await ctx.supabase.from('script_workspace_documents')
    .select('document_id,imported_at').eq('project_id', requireProjectContext(ctx))
    .eq('document_id', documentId).maybeSingle();
  if (error) throw error;
  return data as { document_id: string; imported_at: string } | null;
}

async function script(ctx: ToolContext, libraryId: string) {
  const { data, error } = await ctx.supabase.from('libraries')
    .select('id,project_id,name,description,updated_at,document_export_type,source_document_id')
    .eq('id', libraryId).maybeSingle();
  if (error) throw error;
  if (!data || data.project_id !== requireProjectContext(ctx) || data.document_export_type !== 'script') {
    throw new Error('Script not found in this project.');
  }
  return data as { id: string; project_id: string; name: string; description: string | null; updated_at: string; source_document_id: string | null };
}

async function addDocument(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = documentSchema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Invalid add_script_document parameters.' };
  try {
    await requireRole(ctx, 'editor');
    const target = await document(ctx, parsed.data.documentId);
    await upsertScriptWorkspaceDocument(ctx.supabase, {
      projectId: requireProjectContext(ctx), documentId: target.id, userId: ctx.userId,
    });
    return { success: true, data: { projectId: requireProjectContext(ctx), documentId: target.id, name: target.name },
      invalidations: [{ type: 'script-workspace', projectId: requireProjectContext(ctx), documentId: target.id }] };
  } catch (error) { return failure(error); }
}

async function prepareRemove(params: unknown, ctx: ToolContext): Promise<ConfirmationPreparation> {
  const parsed = documentSchema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Invalid remove_script_document parameters.' };
  try {
    await requireRole(ctx, 'editor');
    const target = await document(ctx, parsed.data.documentId);
    const member = await membership(ctx, target.id);
    if (!member) return { success: false, error: 'Document is not in this Script workspace.' };
    return { success: true,
      args: { documentId: target.id, expectedImportedAt: member.imported_at, expectedName: target.name, expectedUpdatedAt: target.updated_at },
      preview: { projectId: requireProjectContext(ctx), documentId: target.id, name: target.name,
        consequence: 'Remove this document from Script workspace; the Studio document stays intact.' } };
  } catch (error) { return { success: false, error: failure(error).error! }; }
}

async function removeDocument(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = documentSchema.safeParse(params);
  if (!parsed.success || !parsed.data.expectedImportedAt || !parsed.data.expectedName || !parsed.data.expectedUpdatedAt) {
    return { success: false, error: 'Removal confirmation data is unavailable; preview again.' };
  }
  try {
    await requireRole(ctx, 'editor');
    const target = await document(ctx, parsed.data.documentId);
    const member = await membership(ctx, target.id);
    if (!member || member.imported_at !== parsed.data.expectedImportedAt || target.name !== parsed.data.expectedName || target.updated_at !== parsed.data.expectedUpdatedAt) {
      return { success: false, error: 'Target changed after approval; preview the action again.' };
    }
    await deleteScriptWorkspaceDocument(ctx.supabase, { projectId: requireProjectContext(ctx), documentId: target.id });
    return { success: true, data: { projectId: requireProjectContext(ctx), documentId: target.id, removed: true },
      invalidations: [{ type: 'script-workspace', projectId: requireProjectContext(ctx), documentId: target.id }] };
  } catch (error) { return failure(error); }
}

async function prepareScript(params: unknown, ctx: ToolContext, action: 'rename' | 'delete'): Promise<ConfirmationPreparation> {
  const parsed = (action === 'rename' ? renameSchema : librarySchema).safeParse(params);
  if (!parsed.success) return { success: false, error: `Invalid ${action}_script parameters.` };
  try {
    await requireRole(ctx, 'admin');
    const target = await script(ctx, parsed.data.libraryId);
    const name = 'name' in parsed.data ? parsed.data.name : undefined;
    return { success: true,
      args: { libraryId: target.id, ...(name ? { name } : {}), expectedName: target.name, expectedUpdatedAt: target.updated_at },
      preview: { projectId: requireProjectContext(ctx), libraryId: target.id, currentName: target.name,
        ...(name ? { name } : { consequence: 'Permanently delete this Script and its table data.' }) } };
  } catch (error) { return { success: false, error: failure(error).error! }; }
}

async function mutateScript(params: unknown, ctx: ToolContext, action: 'rename' | 'delete'): Promise<ToolResult> {
  const parsed = (action === 'rename' ? renameSchema : librarySchema).safeParse(params);
  if (!parsed.success || !parsed.data.expectedName || !parsed.data.expectedUpdatedAt) {
    return { success: false, error: 'Script confirmation data is unavailable; preview again.' };
  }
  try {
    await requireRole(ctx, 'admin');
    const target = await script(ctx, parsed.data.libraryId);
    if (target.name !== parsed.data.expectedName || target.updated_at !== parsed.data.expectedUpdatedAt) {
      return { success: false, error: 'Target changed after approval; preview the action again.' };
    }
    if (action === 'delete') await deleteLibrary(ctx.supabase, target.id);
    else if ('name' in parsed.data && typeof parsed.data.name === 'string') {
      await updateLibrary(ctx.supabase, target.id, { name: parsed.data.name, description: target.description ?? undefined });
    }
    return { success: true, data: { projectId: requireProjectContext(ctx), libraryId: target.id,
      ...(action === 'delete' ? { deleted: true } : { oldName: target.name, name: 'name' in parsed.data ? parsed.data.name : target.name }) },
      invalidations: [{ type: 'library', id: target.id, projectId: requireProjectContext(ctx), sourceDocumentId: target.source_document_id ?? undefined },
        { type: 'project-structure', projectId: requireProjectContext(ctx) },
        { type: 'script-workspace', projectId: requireProjectContext(ctx) }] };
  } catch (error) { return failure(error); }
}

export const addScriptDocumentTool: AgentTool = {
  name: 'add_script_document', description: 'Add an exact project document ID to the Script workspace.',
  category: 'write', confirmationMode: 'pre_execute', requiredPermission: 'editor',
  parameters: { type: 'object', properties: { documentId: { type: 'string', format: 'uuid' } }, required: ['documentId'], additionalProperties: false },
  execute: addDocument,
};

export const removeScriptDocumentTool: AgentTool = {
  name: 'remove_script_document', description: 'Remove an exact document ID from the Script workspace after confirmation; its Studio document remains.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: addScriptDocumentTool.parameters, prepareConfirmation: (params, ctx) => prepareRemove(params, ctx), execute: removeDocument,
};

export const renameScriptTool: AgentTool = {
  name: 'rename_script', description: 'Rename an exact Script library ID in this project after confirmation.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'admin',
  parameters: { type: 'object', properties: { libraryId: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['libraryId', 'name'], additionalProperties: false },
  prepareConfirmation: (params, ctx) => prepareScript(params, ctx, 'rename'), execute: (params, ctx) => mutateScript(params, ctx, 'rename'),
};

export const deleteScriptTool: AgentTool = {
  name: 'delete_script', description: 'Permanently delete an exact Script library ID and its table data after confirmation.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'admin',
  parameters: { type: 'object', properties: { libraryId: { type: 'string', format: 'uuid' } }, required: ['libraryId'], additionalProperties: false },
  prepareConfirmation: (params, ctx) => prepareScript(params, ctx, 'delete'), execute: (params, ctx) => mutateScript(params, ctx, 'delete'),
};
