/**
 * update_asset — modify an asset's fields (pre_execute confirmation).
 */

import { z } from 'zod';
import { updateAsset as updateAssetService } from '@/lib/services/libraryAssetsService';
import {
  resolveAgentReferencePropertyValues,
  validateReferencePropertyValues,
} from '../asset-emptiness';
import { resolveAssetByRowIndex } from '../data-access';
import { scheduleReindexForAssetFields } from '../embedding-index';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { resolvePropertyValues } from '../field-resolver';
import {
  errorFromLookupResult,
  errorFromOkResult,
  getLibraryProperties,
  libraryFromLookupResult,
  resolveLibraryForTool,
} from './_shared';

const ParamsSchema = z
  .object({
    libraryName: z.string().min(1).optional(),
    assetId: z.string().min(1).optional(),
    rowIndex: z.number().int().positive().optional(),
    name: z.string().optional(),
    propertyValues: z.record(z.unknown()).optional(),
  })
  .refine((data) => Boolean(data.assetId || data.rowIndex), {
    message: 'Either assetId or rowIndex is required.',
  });

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    return await executeUpdateAsset(params, ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update asset.';
    return { success: false, error: message };
  }
}

async function executeUpdateAsset(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const libraryName = parsed.data.libraryName ?? ctx.currentLibraryName;
  const { assetId: assetIdParam, rowIndex, name, propertyValues } = parsed.data;
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

  let assetId = assetIdParam;
  let assetRow: { id: string; name: string; library_id?: string } | null = null;

  if (rowIndex !== undefined) {
    const resolved = await resolveAssetByRowIndex(ctx.supabase, library.id, rowIndex);
    if (!resolved) {
      return {
        success: false,
        error: `No asset found at row ${rowIndex} in library "${library.name}".`,
      };
    }
    assetId = resolved.id;
    assetRow = { id: resolved.id, name: resolved.name, library_id: library.id };
  } else if (assetId) {
    const { data, error: assetErr } = await ctx.supabase
      .from('library_assets')
      .select('id, name, library_id')
      .eq('id', assetId)
      .single();
    if (assetErr || !data) {
      return { success: false, error: `Asset "${assetId}" not found.` };
    }
    assetRow = data;
  }

  if (!assetId || !assetRow) {
    return { success: false, error: 'Either assetId or rowIndex is required.' };
  }

  if (assetRow.library_id && assetRow.library_id !== library.id) {
    return { success: false, error: `Asset "${assetId}" does not belong to library "${library.name}".` };
  }

  const [properties, { resolved, unresolved, availableFields }] = await Promise.all([
    getLibraryProperties(ctx.supabase, library.id),
    resolvePropertyValues(ctx.supabase, library.id, propertyValues),
  ]);
  if (unresolved.length > 0) {
    return {
      success: false,
      error: `Unknown field name(s): ${unresolved.join(', ')}. Available fields: ${availableFields.join(', ') || '(none)'}`,
    };
  }

  let resolvedWithReferences: Record<string, unknown>;
  try {
    resolvedWithReferences = await resolveAgentReferencePropertyValues(
      ctx.supabase,
      properties,
      resolved
    );
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to resolve reference values.' };
  }

  const referenceValidation = await validateReferencePropertyValues(
    ctx.supabase,
    properties,
    resolvedWithReferences
  );
  const referenceError = errorFromOkResult(referenceValidation);
  if (referenceError !== undefined) {
    return { success: false, error: referenceError };
  }

  try {
    await updateAssetService(ctx.supabase, assetId, name ?? assetRow.name, resolvedWithReferences);
    scheduleReindexForAssetFields(
      ctx.supabase,
      ctx.projectId,
      assetId,
      Object.keys(resolvedWithReferences)
    );
    return {
      success: true,
      displayHint: 'text',
      data: {
        assetId,
        rowIndex: rowIndex ?? null,
        libraryId: library.id,
        libraryName: library.name,
        name: name ?? assetRow.name,
      },
      invalidateCache: [library.id],
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to update asset.' };
  }
}

export const updateAsset: AgentTool = {
  name: 'update_asset',
  description:
    'Modify fields of an existing asset. Prefer rowIndex when the user names a table row (e.g. "write to row 1" → rowIndex=1). Reference fields: pass referenceTargets from query_assets (assetId+fieldId per cell). Params: libraryName, rowIndex OR assetId, propertyValues.',
  category: 'write',
  confirmationMode: 'pre_execute',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      libraryName: {
        type: 'string',
        description: 'Library containing the row to update. Omit to use the active library.',
      },
      rowIndex: {
        type: 'number',
        description:
          'UI row number to update (1 = first row). Use this when the user says "第一行" / "row 1". Preferred over assetId for row targeting.',
      },
      assetId: { type: 'string', description: 'UUID of the asset to update. Omit when rowIndex is provided.' },
      name: { type: 'string', description: 'New asset name (optional)' },
      propertyValues: {
        type: 'object',
        description: 'Field values to set, keyed by semantic field name. Optional.',
        additionalProperties: true,
      },
    },
    required: [],
  },
  execute,
};
