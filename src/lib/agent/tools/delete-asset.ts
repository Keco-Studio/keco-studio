/**
 * delete_asset — remove an asset from a library (pre_execute confirmation).
 */

import { requireProjectContext } from '../workspace';
import { z } from 'zod';
import type { AgentTool, ConfirmationPreparation, ToolContext, ToolResult } from '../types';
import { errorFromLookupResult, libraryFromLookupResult, resolveLibraryForTool } from './_shared';

const ParamsSchema = z.object({
  libraryName: z.string().min(1).optional(),
  assetId: z.string().uuid(),
}).strict();
const SealedSchema = z.object({
  projectId: z.string().uuid(), libraryId: z.string().uuid(), libraryName: z.string(),
  assetId: z.string().uuid(), name: z.string(), updatedAt: z.string(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

async function prepareConfirmation(params: unknown, ctx: ToolContext): Promise<ConfirmationPreparation> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const libraryName = parsed.data.libraryName ?? ctx.currentLibraryName;
  const { assetId } = parsed.data;
  if (!libraryName) {
    return {
      success: false,
      error: 'No library specified. Ask the user which library, or navigate to a library page first.',
    };
  }

  const libraryResult = await resolveLibraryForTool(ctx.supabase, requireProjectContext(ctx), libraryName, ctx);
  const libraryLookupError = errorFromLookupResult(libraryResult);
  if (libraryLookupError !== undefined) {
    return { success: false, error: libraryLookupError };
  }
  const library = libraryFromLookupResult(libraryResult);

  try {
    const { data, error } = await ctx.supabase.rpc('agent_prepare_asset_delete', {
      p_project_id: requireProjectContext(ctx), p_library_id: library.id, p_asset_id: assetId,
    });
    if (error) throw error;
    const snapshot = SealedSchema.parse(data);
    return {
      success: true,
      args: snapshot,
      preview: { action: 'delete_asset', projectId: snapshot.projectId,
        libraryId: snapshot.libraryId, libraryName: snapshot.libraryName,
        assetId: snapshot.assetId, name: snapshot.name, updatedAt: snapshot.updatedAt,
        fingerprint: snapshot.fingerprint, consequence: 'Permanently delete this asset and its values.' },
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to preview asset deletion.' };
  }
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = SealedSchema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Delete confirmation data is unavailable; please retry.' };
  const input = parsed.data;
  if (input.projectId !== requireProjectContext(ctx)) {
    return { success: false, error: 'Asset is outside this conversation.' };
  }
  try {
    const { data, error } = await ctx.supabase.rpc('agent_delete_asset_if_current', {
      p_project_id: input.projectId, p_library_id: input.libraryId, p_asset_id: input.assetId,
      p_expected_library_name: input.libraryName, p_expected_name: input.name,
      p_expected_updated_at: input.updatedAt, p_expected_fingerprint: input.fingerprint,
    });
    if (error) throw error;
    if (data !== input.assetId) throw new Error('Asset changed after approval; review the deletion again.');
    return { success: true, displayHint: 'text',
      data: { assetId: input.assetId, libraryId: input.libraryId, libraryName: input.libraryName, name: input.name },
      invalidations: [{ type: 'library', id: input.libraryId }] };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to delete asset.' };
  }
}

export const deleteAsset: AgentTool = {
  name: 'delete_asset',
  description:
    'Delete an asset (row) from a library. libraryName defaults to the active library from page context when omitted. Params: assetId (required), libraryName (optional).',
  category: 'write',
  confirmationMode: 'pre_execute',
  confirmationPolicy: 'always',
  requiredPermission: 'editor',
  prepareConfirmation,
  parameters: {
    type: 'object',
    properties: {
      libraryName: {
        type: 'string',
        description: 'Name of the library the asset belongs to. Omit to use the active library from page context.',
      },
      assetId: { type: 'string', description: 'UUID of the asset to delete' },
    },
    required: ['assetId'],
  },
  execute,
};
