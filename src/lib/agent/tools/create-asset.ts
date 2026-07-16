/**
 * create_asset — add a new asset to a library (pre_execute confirmation).
 */

import { z } from 'zod';
import {
  createAsset as createAssetService,
  updateAsset as updateAssetService,
} from '@/lib/services/libraryAssetsService';
import {
  findFirstEmptyUiRowAsset,
  resolveAgentReferencePropertyValues,
  validateReferencePropertyValues,
} from '../asset-emptiness';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { scheduleReindexForAssetFields } from '../embedding-index';
import { resolvePropertyValues, isExplicitEmptyPropertyValues, buildEmptyPropertyValuesError } from '../field-resolver';
import { prepareAgentPropertyValues } from '../property-value-validation';
import { getLibraryAssets } from '../data-access';
import {
  errorFromLookupResult,
  errorFromOkResult,
  getLibraryProperties,
  libraryFromLookupResult,
  resolveLibraryForTool,
} from './_shared';

const ParamsSchema = z.object({
  libraryName: z.string().min(1).optional(),
  name: z.string().min(1),
  propertyValues: z.record(z.unknown()).optional(),
});

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const libraryName = parsed.data.libraryName ?? ctx.currentLibraryName;
  const { name, propertyValues } = parsed.data;
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

  if (isExplicitEmptyPropertyValues(params)) {
    const { availableFields } = await resolvePropertyValues(ctx.supabase, library.id, undefined);
    return { success: false, error: buildEmptyPropertyValuesError(availableFields) };
  }

  const [properties, { resolved, unresolved, availableFields }] = await Promise.all([
    getLibraryProperties(ctx.supabase, library.id, ctx),
    resolvePropertyValues(ctx.supabase, library.id, propertyValues),
  ]);
  if (unresolved.length > 0) {
    return {
      success: false,
      error: `Unknown field name(s): ${unresolved.join(', ')}. Available fields: ${availableFields.join(', ') || '(none)'}`,
    };
  }

  const prepared = prepareAgentPropertyValues(resolved, properties, {
    assetName: name,
    requireAllRequired: true,
  });
  if ('error' in prepared) {
    return { success: false, error: prepared.error };
  }
  const normalizedResolved = prepared.values;

  let resolvedWithReferences: Record<string, unknown>;
  try {
    resolvedWithReferences = await resolveAgentReferencePropertyValues(
      ctx.supabase,
      properties,
      normalizedResolved
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
    const assets = await getLibraryAssets(ctx.supabase, library.id, ctx);
    const emptyRow = findFirstEmptyUiRowAsset(assets);

    if (emptyRow) {
      await updateAssetService(
        ctx.supabase,
        emptyRow.asset.id,
        name,
        resolvedWithReferences
      );
      scheduleReindexForAssetFields(
        ctx.supabase,
        ctx.projectId,
        emptyRow.asset.id,
        Object.keys(resolvedWithReferences)
      );
      return {
        success: true,
        displayHint: 'text',
        data: {
          assetId: emptyRow.asset.id,
          libraryId: library.id,
          libraryName: library.name,
          name,
          rowIndex: emptyRow.rowIndex,
          reusedEmptyRow: true,
        },
        invalidations: [{ type: 'library', id: library.id }],
      };
    }

    const assetId = await createAssetService(ctx.supabase, library.id, name, resolvedWithReferences);
    scheduleReindexForAssetFields(
      ctx.supabase,
      ctx.projectId,
      assetId,
      Object.keys(resolvedWithReferences)
    );
    return {
      success: true,
      displayHint: 'text',
      data: { assetId, libraryId: library.id, libraryName: library.name, name },
      invalidations: [{ type: 'library', id: library.id }],
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to create asset.' };
  }
}

export const createAsset: AgentTool = {
  name: 'create_asset',
  description:
    'Add a new asset (row) to a library. Reuses the first empty UI row when one exists (row 1 if blank), otherwise appends. Use semantic field names in propertyValues (e.g. {"type": "character"}). Reference fields cannot target empty assets. libraryName defaults to the user\'s active library from page context when omitted. Params: name (required), libraryName (optional), propertyValues.',
  category: 'write',
  confirmationMode: 'pre_execute',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      libraryName: {
        type: 'string',
        description: 'Name of the target library. Omit to use the active library from page context.',
      },
      name: { type: 'string', description: 'Name of the new asset' },
      propertyValues: {
        type: 'object',
        description: 'Field values keyed by semantic field name. Optional.',
        additionalProperties: true,
      },
    },
    required: ['name'],
  },
  execute,
};
