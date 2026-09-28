import { z } from 'zod';
import {
  getFolder, listFolders,
} from '@/lib/services/folderService';
import {
  getLibrary,
} from '@/lib/services/libraryService';
import {
  getUserProjectRole, verifyFolderCreationPermission, verifyFolderDeletionPermission,
  verifyFolderUpdatePermission, verifyLibraryUpdatePermission,
} from '@/lib/services/authorizationService';
import { requireProjectContext } from '../workspace';
import { applyStudioStructureChange } from '../studio-structure-cas-tool-service';
import type { AgentTool, ConfirmationPreparation, ToolContext, ToolResult } from '../types';

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(200);
const folderEditSchema = z.object({ folderId: uuid, name: name.optional(), description: z.string().trim().max(1000).nullable().optional(), expectedUpdatedAt: z.string().optional() }).strict().refine((value) => value.name !== undefined || value.description !== undefined);
const folderMoveSchema = z.object({ folderId: uuid, parentFolderId: uuid.nullable(), expectedUpdatedAt: z.string().optional() }).strict();
const folderIdSchema = z.object({ folderId: uuid, expectedUpdatedAt: z.string().optional(), expectedFingerprint: z.string().optional() }).strict();
const folderDuplicateSchema = z.object({ folderId: uuid, idempotencyKey: uuid,
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
const libraryEditSchema = z.object({ libraryId: uuid, name: name.optional(), description: z.string().trim().max(1000).nullable().optional(), expectedUpdatedAt: z.string().optional() }).strict().refine((value) => value.name !== undefined || value.description !== undefined);
const libraryMoveSchema = z.object({ libraryId: uuid, folderId: uuid.nullable(), expectedUpdatedAt: z.string().optional() }).strict();
const libraryDuplicateSchema = z.object({ libraryId: uuid, newName: name, copyHeaderOnly: z.boolean(),
  folderId: uuid.nullable().optional(), idempotencyKey: uuid,
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

function failed(error: unknown): ToolResult {
  const message = error && typeof error === 'object' && 'message' in error
    && typeof error.message === 'string' ? error.message : '';
  const known = new Set([
    'Folder not found in this project.',
    'Library not found in this project.',
    'Target changed after approval; preview the action again.',
    'A folder cannot be its own parent.',
    'A folder cannot move into its descendant.',
    'Folder hierarchy contains a cycle.',
    'Only admin and editor users can duplicate libraries.',
    'Only admin users can create folders',
    'Only admin users can update folders',
    'Only admin users can update libraries',
    'Only admin users can delete folders',
    'Project context is unavailable.',
  ]);
  if (known.has(message)) return { success: false, error: message };
  if (message === 'Folder contents changed after approval') {
    return { success: false, error: 'Folder contents changed after approval; preview the action again.' };
  }
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'PT409') {
    return { success: false, error: 'Target changed after approval; preview the action again.' };
  }
  if (code === '42501') return { success: false, error: 'You do not have permission to change this Studio structure.' };
  return { success: false, error: 'Studio operation failed.' };
}

function invalidations(projectId: string, libraryId?: string): ToolResult['invalidations'] {
  return libraryId
    ? [{ type: 'library', id: libraryId, projectId }, { type: 'project-structure', projectId }]
    : [{ type: 'project-structure', projectId }];
}

async function projectFolder(ctx: ToolContext, folderId: string) {
  const folder = await getFolder(ctx.supabase, folderId);
  if (!folder || folder.project_id !== requireProjectContext(ctx)) throw new Error('Folder not found in this project.');
  return folder;
}

async function projectLibrary(ctx: ToolContext, libraryId: string) {
  const library = await getLibrary(ctx.supabase, libraryId);
  if (!library || library.project_id !== requireProjectContext(ctx)) throw new Error('Library not found in this project.');
  return library;
}

function ensureUnchanged(actual: string, expected?: string) {
  if (expected && actual !== expected) throw new Error('Target changed after approval; preview the action again.');
}

async function assertFolderMove(ctx: ToolContext, folderId: string, parentFolderId: string | null) {
  if (parentFolderId === null) return;
  if (parentFolderId === folderId) throw new Error('A folder cannot be its own parent.');
  await projectFolder(ctx, parentFolderId);
  const folders = await listFolders(ctx.supabase, requireProjectContext(ctx));
  const parents = new Map(folders.map((folder) => [folder.id, folder.parent_folder_id]));
  const visited = new Set<string>();
  let cursor: string | null = parentFolderId;
  while (cursor) {
    if (cursor === folderId) throw new Error('A folder cannot move into its descendant.');
    if (visited.has(cursor)) throw new Error('Folder hierarchy contains a cycle.');
    visited.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
}

const folderDeleteSnapshotSchema = z.object({
  projectId: uuid, folderId: uuid, name: z.string(), updatedAt: z.string(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/), rowCount: z.number().int().nonnegative(),
  tableCounts: z.record(z.string(), z.number().int().nonnegative()),
});

async function prepareFolderEdit(params: unknown, ctx: ToolContext): Promise<ConfirmationPreparation> {
  const parsed = folderEditSchema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Invalid update_folder parameters.' };
  try {
    const folder = await projectFolder(ctx, parsed.data.folderId);
    await verifyFolderUpdatePermission(ctx.supabase, folder.id, ctx.userId);
    return { success: true, args: { ...parsed.data, name: parsed.data.name ?? folder.name, expectedUpdatedAt: folder.updated_at }, preview: { folderId: folder.id, currentName: folder.name, name: parsed.data.name ?? folder.name } };
  } catch (error) { return { success: false, error: failed(error).error! }; }
}

export const updateFolderTool: AgentTool = {
  name: 'update_folder', description: 'Rename or edit the description of an exact folder ID in this project. Requires admin.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'admin', prepareConfirmation: prepareFolderEdit,
  parameters: { type: 'object', additionalProperties: false, properties: {
    folderId: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: ['string', 'null'], maxLength: 1000 },
  }, required: ['folderId'] },
  async execute(params, ctx) {
    const parsed = folderEditSchema.safeParse(params);
    if (!parsed.success || !parsed.data.expectedUpdatedAt) return { success: false, error: 'Folder update confirmation data is unavailable.' };
    try {
      const folder = await projectFolder(ctx, parsed.data.folderId);
      await verifyFolderUpdatePermission(ctx.supabase, folder.id, ctx.userId);
      ensureUnchanged(folder.updated_at, parsed.data.expectedUpdatedAt);
      const nextName = parsed.data.name ?? folder.name;
      const description = parsed.data.description === undefined ? folder.description : parsed.data.description;
      await applyStudioStructureChange(ctx, { action: 'update_folder', targetId: folder.id,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt, name: nextName, description });
      return { success: true, data: { folderId: folder.id, name: nextName }, invalidations: invalidations(requireProjectContext(ctx)) };
    } catch (error) { return failed(error); }
  },
};

export const moveFolderTool: AgentTool = {
  name: 'move_folder', description: 'Move an exact folder ID to another folder ID or project root. Requires admin.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'admin',
  parameters: { type: 'object', additionalProperties: false, properties: {
    folderId: { type: 'string', format: 'uuid' }, parentFolderId: { type: ['string', 'null'], format: 'uuid' },
  }, required: ['folderId', 'parentFolderId'] },
  async prepareConfirmation(params, ctx) {
    const parsed = folderMoveSchema.safeParse(params);
    if (!parsed.success) return { success: false, error: 'Invalid move_folder parameters.' };
    try {
      const folder = await projectFolder(ctx, parsed.data.folderId);
      await verifyFolderUpdatePermission(ctx.supabase, folder.id, ctx.userId);
      await assertFolderMove(ctx, folder.id, parsed.data.parentFolderId);
      return { success: true, args: { ...parsed.data, expectedUpdatedAt: folder.updated_at }, preview: { folderId: folder.id, name: folder.name, parentFolderId: parsed.data.parentFolderId } };
    } catch (error) { return { success: false, error: failed(error).error! }; }
  },
  async execute(params, ctx) {
    const parsed = folderMoveSchema.safeParse(params);
    if (!parsed.success || !parsed.data.expectedUpdatedAt) return { success: false, error: 'Folder move confirmation data is unavailable.' };
    try {
      const folder = await projectFolder(ctx, parsed.data.folderId);
      await verifyFolderUpdatePermission(ctx.supabase, folder.id, ctx.userId);
      ensureUnchanged(folder.updated_at, parsed.data.expectedUpdatedAt);
      await assertFolderMove(ctx, folder.id, parsed.data.parentFolderId);
      await applyStudioStructureChange(ctx, { action: 'move_folder', targetId: folder.id,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt, destinationId: parsed.data.parentFolderId });
      return { success: true, data: { folderId: folder.id, parentFolderId: parsed.data.parentFolderId }, invalidations: invalidations(requireProjectContext(ctx)) };
    } catch (error) { return failed(error); }
  },
};

export const duplicateFolderTool: AgentTool = {
  name: 'duplicate_folder', description: 'Atomically duplicate an exact folder ID and its direct libraries/documents in this project. Reuse the UUID idempotencyKey on retries. Requires admin.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'admin',
  parameters: { type: 'object', additionalProperties: false, properties: {
    folderId: { type: 'string', format: 'uuid' }, idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['folderId', 'idempotencyKey'] },
  async prepareConfirmation(params, ctx) {
    const parsed = folderDuplicateSchema.safeParse(params);
    if (!parsed.success) return { success: false, error: 'Invalid duplicate_folder parameters.' };
    try {
      const folder = await projectFolder(ctx, parsed.data.folderId);
      await verifyFolderCreationPermission(ctx.supabase, requireProjectContext(ctx), ctx.userId);
      const { data, error } = await ctx.supabase.rpc('agent_prepare_folder_copy', {
        p_project_id: folder.project_id, p_source_id: folder.id,
      });
      if (error) throw error;
      const snapshot = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).parse(data);
      return { success: true, args: { ...parsed.data, expectedFingerprint: snapshot.fingerprint },
        preview: { folderId: folder.id, name: folder.name, destination: 'project root',
          consequence: 'Copy this folder and its direct independent libraries and documents.' } };
    } catch (error) { return { success: false, error: failed(error).error! }; }
  },
  async execute(params, ctx) {
    const parsed = folderDuplicateSchema.safeParse(params);
    if (!parsed.success || !parsed.data.expectedFingerprint) return { success: false, error: 'Folder copy confirmation data is unavailable.' };
    try {
      const folder = await projectFolder(ctx, parsed.data.folderId);
      await verifyFolderCreationPermission(ctx.supabase, requireProjectContext(ctx), ctx.userId);
      const { data: newFolderId, error } = await ctx.supabase.rpc('agent_duplicate_folder_if_current', {
        p_project_id: folder.project_id, p_source_id: folder.id,
        p_expected_fingerprint: parsed.data.expectedFingerprint,
        p_idempotency_key: parsed.data.idempotencyKey,
      });
      if (error) throw error;
      if (typeof newFolderId !== 'string') throw new Error('Folder copy returned no result.');
      return { success: true, data: { sourceFolderId: folder.id, folderId: newFolderId }, invalidations: invalidations(requireProjectContext(ctx)) };
    } catch (error) { return failed(error); }
  },
};

export const deleteFolderTool: AgentTool = {
  name: 'delete_folder', description: 'Permanently delete an exact folder ID, all nested folders, documents, libraries, and their data. Requires admin and confirmation.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'admin',
  parameters: { type: 'object', additionalProperties: false, properties: { folderId: { type: 'string', format: 'uuid' } }, required: ['folderId'] },
  async prepareConfirmation(params, ctx) {
    const parsed = folderIdSchema.safeParse(params);
    if (!parsed.success) return { success: false, error: 'Invalid delete_folder parameters.' };
    try {
      const folder = await projectFolder(ctx, parsed.data.folderId);
      await verifyFolderDeletionPermission(ctx.supabase, folder.id, ctx.userId);
      const { data, error } = await ctx.supabase.rpc('agent_prepare_folder_cascade_delete', {
        p_project_id: folder.project_id, p_folder_id: folder.id,
      });
      if (error) throw error;
      const snapshot = folderDeleteSnapshotSchema.parse(data);
      return {
        success: true,
        args: { folderId: folder.id, expectedFingerprint: snapshot.fingerprint },
        preview: { projectId: folder.project_id, folderId: folder.id, name: folder.name,
          affectedRows: snapshot.rowCount, affectedTables: snapshot.tableCounts,
          consequence: 'Permanently delete this folder and its nested contents.' },
      };
    } catch (error) { return { success: false, error: failed(error).error! }; }
  },
  async execute(params, ctx) {
    const parsed = folderIdSchema.safeParse(params);
    if (!parsed.success || !parsed.data.expectedFingerprint) return { success: false, error: 'Delete confirmation data is unavailable; please retry.' };
    try {
      const folder = await projectFolder(ctx, parsed.data.folderId);
      await verifyFolderDeletionPermission(ctx.supabase, folder.id, ctx.userId);
      const { error } = await ctx.supabase.rpc('agent_delete_folder_cascade_if_current', {
        p_project_id: folder.project_id,
        p_folder_id: folder.id,
        p_expected_fingerprint: parsed.data.expectedFingerprint,
      });
      if (error) throw error;
      return { success: true, data: { folderId: folder.id, name: folder.name, deleted: true }, invalidations: invalidations(requireProjectContext(ctx)) };
    } catch (error) { return failed(error); }
  },
};

export const updateLibraryTool: AgentTool = {
  name: 'update_library_metadata', description: 'Update the name or description of an exact library ID in this project. Requires admin.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'admin',
  parameters: { type: 'object', additionalProperties: false, properties: {
    libraryId: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: ['string', 'null'], maxLength: 1000 },
  }, required: ['libraryId'] },
  async prepareConfirmation(params, ctx) {
    const parsed = libraryEditSchema.safeParse(params);
    if (!parsed.success) return { success: false, error: 'Invalid update_library_metadata parameters.' };
    try {
      const library = await projectLibrary(ctx, parsed.data.libraryId);
      await verifyLibraryUpdatePermission(ctx.supabase, library.id, ctx.userId);
      return { success: true, args: { ...parsed.data, name: parsed.data.name ?? library.name, expectedUpdatedAt: library.updated_at }, preview: { libraryId: library.id, currentName: library.name, name: parsed.data.name ?? library.name } };
    } catch (error) { return { success: false, error: failed(error).error! }; }
  },
  async execute(params, ctx) {
    const parsed = libraryEditSchema.safeParse(params);
    if (!parsed.success || !parsed.data.expectedUpdatedAt) return { success: false, error: 'Library update confirmation data is unavailable.' };
    try {
      const library = await projectLibrary(ctx, parsed.data.libraryId);
      await verifyLibraryUpdatePermission(ctx.supabase, library.id, ctx.userId);
      ensureUnchanged(library.updated_at, parsed.data.expectedUpdatedAt);
      const nextName = parsed.data.name ?? library.name;
      const description = parsed.data.description === undefined ? library.description : parsed.data.description;
      await applyStudioStructureChange(ctx, { action: 'update_library_metadata', targetId: library.id,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt, name: nextName, description });
      return { success: true, data: { libraryId: library.id, name: nextName }, invalidations: invalidations(requireProjectContext(ctx), library.id) };
    } catch (error) { return failed(error); }
  },
};

export const moveLibraryTool: AgentTool = {
  name: 'move_library', description: 'Move an independent library by exact ID to a folder ID or project root. Requires admin.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'admin',
  parameters: { type: 'object', additionalProperties: false, properties: {
    libraryId: { type: 'string', format: 'uuid' }, folderId: { type: ['string', 'null'], format: 'uuid' },
  }, required: ['libraryId', 'folderId'] },
  async prepareConfirmation(params, ctx) {
    const parsed = libraryMoveSchema.safeParse(params);
    if (!parsed.success) return { success: false, error: 'Invalid move_library parameters.' };
    try {
      const library = await projectLibrary(ctx, parsed.data.libraryId);
      await verifyLibraryUpdatePermission(ctx.supabase, library.id, ctx.userId);
      if (parsed.data.folderId) await projectFolder(ctx, parsed.data.folderId);
      return { success: true, args: { ...parsed.data, expectedUpdatedAt: library.updated_at }, preview: { libraryId: library.id, name: library.name, folderId: parsed.data.folderId } };
    } catch (error) { return { success: false, error: failed(error).error! }; }
  },
  async execute(params, ctx) {
    const parsed = libraryMoveSchema.safeParse(params);
    if (!parsed.success || !parsed.data.expectedUpdatedAt) return { success: false, error: 'Library move confirmation data is unavailable.' };
    try {
      const library = await projectLibrary(ctx, parsed.data.libraryId);
      await verifyLibraryUpdatePermission(ctx.supabase, library.id, ctx.userId);
      ensureUnchanged(library.updated_at, parsed.data.expectedUpdatedAt);
      if (parsed.data.folderId) await projectFolder(ctx, parsed.data.folderId);
      await applyStudioStructureChange(ctx, { action: 'move_library', targetId: library.id,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt, destinationId: parsed.data.folderId });
      return { success: true, data: { libraryId: library.id, folderId: parsed.data.folderId }, invalidations: invalidations(requireProjectContext(ctx), library.id) };
    } catch (error) { return failed(error); }
  },
};

export const duplicateLibraryTool: AgentTool = {
  name: 'duplicate_library', description: 'Atomically duplicate an exact independent library with a new name. Editors may copy its fields and optionally all rows. Reuse the UUID idempotencyKey on retries.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', additionalProperties: false, properties: {
    libraryId: { type: 'string', format: 'uuid' }, newName: { type: 'string', minLength: 1, maxLength: 200 }, copyHeaderOnly: { type: 'boolean' }, folderId: { type: ['string', 'null'], format: 'uuid' },
    idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['libraryId', 'newName', 'copyHeaderOnly', 'idempotencyKey'] },
  async prepareConfirmation(params, ctx) {
    const parsed = libraryDuplicateSchema.safeParse(params);
    if (!parsed.success) return { success: false, error: 'Invalid duplicate_library parameters.' };
    try {
      const library = await projectLibrary(ctx, parsed.data.libraryId);
      const { role } = await getUserProjectRole(ctx.supabase, library.project_id, ctx.userId);
      if (role !== 'admin' && role !== 'editor') throw new Error('Only admin and editor users can duplicate libraries.');
      if (parsed.data.folderId) await projectFolder(ctx, parsed.data.folderId);
      const { data, error } = await ctx.supabase.rpc('agent_prepare_library_copy', {
        p_project_id: library.project_id, p_source_id: library.id,
      });
      if (error) throw error;
      const snapshot = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).parse(data);
      return { success: true, args: { ...parsed.data, expectedFingerprint: snapshot.fingerprint },
        preview: { libraryId: library.id, name: library.name, newName: parsed.data.newName,
          copyHeaderOnly: parsed.data.copyHeaderOnly, folderId: parsed.data.folderId ?? library.folder_id } };
    } catch (error) { return { success: false, error: failed(error).error! }; }
  },
  async execute(params, ctx) {
    const parsed = libraryDuplicateSchema.safeParse(params);
    if (!parsed.success || !parsed.data.expectedFingerprint) return { success: false, error: 'Library copy confirmation data is unavailable.' };
    try {
      const library = await projectLibrary(ctx, parsed.data.libraryId);
      const { role } = await getUserProjectRole(ctx.supabase, library.project_id, ctx.userId);
      if (role !== 'admin' && role !== 'editor') throw new Error('Only admin and editor users can duplicate libraries.');
      if (parsed.data.folderId) await projectFolder(ctx, parsed.data.folderId);
      const { data: newLibraryId, error } = await ctx.supabase.rpc('agent_duplicate_library_if_current', {
        p_project_id: library.project_id, p_source_id: library.id,
        p_name: parsed.data.newName, p_copy_header_only: parsed.data.copyHeaderOnly,
        p_target_folder_id: parsed.data.folderId === undefined ? library.folder_id : parsed.data.folderId,
        p_expected_fingerprint: parsed.data.expectedFingerprint,
        p_idempotency_key: parsed.data.idempotencyKey,
      });
      if (error) throw error;
      if (typeof newLibraryId !== 'string') throw new Error('Library copy returned no result.');
      return { success: true, data: { sourceLibraryId: library.id, libraryId: newLibraryId, name: parsed.data.newName }, invalidations: invalidations(requireProjectContext(ctx), newLibraryId) };
    } catch (error) { return failed(error); }
  },
};
