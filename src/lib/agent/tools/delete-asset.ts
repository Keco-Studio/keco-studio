/**
 * delete_asset — remove an asset from a library (pre_execute confirmation).
 */

import { z } from 'zod';
import { deleteAsset as deleteAssetService } from '@/lib/services/libraryAssetsService';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { errorFromLookupResult, libraryFromLookupResult, resolveLibraryForTool } from './_shared';

const ParamsSchema = z.object({
  libraryName: z.string().min(1).optional(),
  assetId: z.string().min(1),
});

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
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

  const libraryResult = await resolveLibraryForTool(ctx.supabase, ctx.projectId, libraryName, ctx);
  const libraryLookupError = errorFromLookupResult(libraryResult);
  if (libraryLookupError !== undefined) {
    return { success: false, error: libraryLookupError };
  }
  const library = libraryFromLookupResult(libraryResult);

  const { data: assetRow, error: assetErr } = await ctx.supabase
    .from('library_assets')
    .select('id, name, library_id')
    .eq('id', assetId)
    .single();
  if (assetErr || !assetRow) {
    return { success: false, error: `Asset "${assetId}" not found.` };
  }
  if (assetRow.library_id !== library.id) {
    return { success: false, error: `Asset "${assetId}" does not belong to library "${library.name}".` };
  }

  try {
    await deleteAssetService(ctx.supabase, assetId);
    return {
      success: true,
      displayHint: 'text',
      data: { assetId, libraryId: library.id, libraryName: library.name, name: assetRow.name },
      invalidations: [{ type: 'library', id: library.id }],
    };
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
  requiredPermission: 'editor',
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
