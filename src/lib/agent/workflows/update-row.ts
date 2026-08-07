/**
 * update_row — skill that updates a row identified by its 1-based UI rowIndex.
 *
 * Code-orchestrated composite tool (post_preview confirmation):
 * - execute()       NON-MUTATING. Resolves the library + row, maps semantic field
 *                   names to ids, resolves/validates reference targets, and returns
 *                   a preview (displayHint: 'skill_preview'). No DB write.
 * - executeImport() MUTATING. Persists the previewed values via updateAsset.
 *
 * Eliminates the "wrong row" failure: the row is selected deterministically by
 * rowIndex instead of letting the LLM guess an assetId.
 */

import { z } from 'zod';
import { updateAsset as updateAssetService } from '@/lib/services/libraryAssetsService';
import { sortAssetsForUiRow } from '@/lib/utils/assetEmptiness';
import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  resolveAgentReferencePropertyValues,
  validateReferencePropertyValues,
} from '../asset-emptiness';
import { buildFieldLabelMap, getLibraryAssets, getLibraryProperties } from '../data-access';
import { resolvePropertyValues, isExplicitEmptyPropertyValues, buildEmptyPropertyValuesError } from '../field-resolver';
import { prepareAgentPropertyValues } from '../property-value-validation';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { scheduleReindexForAssetFields } from '../embedding-index';
import { removeUnusedDefaultIdField } from '../default-id-cleanup';
import {
  errorFromLookupResult,
  errorFromOkResult,
  libraryFromLookupResult,
  resolveLibraryForTool,
} from '../tools/_shared';

const ParamsSchema = z.object({
  libraryName: z.string().min(1).optional(),
  rowIndex: z.number().int().positive(),
  propertyValues: z.record(z.unknown()),
});

interface UpdateRowPreview {
  type: 'update_row';
  libraryName: string;
  libraryId: string;
  rowIndex: number;
  assetId: string;
  assetName: string;
  changes: Array<{ field: string; value: unknown }>;
  existingValues: Record<string, unknown>;
  /** fieldId-keyed values (with resolved references) for executeImport. */
  resolvedValues: Record<string, unknown>;
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    return await executeUpdateRow(params, ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update row.';
    return { success: false, error: message };
  }
}

async function executeUpdateRow(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const { rowIndex, propertyValues } = parsed.data;
  const libraryName = parsed.data.libraryName ?? ctx.currentLibraryName;
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

  const assets = await getLibraryAssets(ctx.supabase, library.id, ctx);
  const sorted = sortAssetsForUiRow(assets);
  if (rowIndex > sorted.length) {
    return {
      success: false,
      error: `Row ${rowIndex} does not exist in library "${library.name}" (library has ${sorted.length} row${sorted.length === 1 ? '' : 's'}).`,
    };
  }
  const targetAsset = sorted[rowIndex - 1];

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
      error: `Unknown field(s): ${unresolved.join(', ')}. Available fields: ${availableFields.join(', ') || '(none)'}`,
    };
  }

  const prepared = prepareAgentPropertyValues(resolved, properties, {
    requireAllRequired: false,
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

  const labelByFieldId = buildFieldLabelMap(properties);
  const preview: UpdateRowPreview = {
    type: 'update_row',
    libraryName: library.name,
    libraryId: library.id,
    rowIndex,
    assetId: targetAsset.id,
    assetName: targetAsset.name,
    changes: Object.entries(resolvedWithReferences).map(([fieldId, value]) => ({
      field: labelByFieldId[fieldId] ?? fieldId,
      value,
    })),
    existingValues: buildExistingValues(targetAsset, resolvedWithReferences, labelByFieldId),
    resolvedValues: resolvedWithReferences,
  };

  return { success: true, displayHint: 'skill_preview', data: preview };
}

/** Snapshot the current value of every field being changed (label-keyed). */
function buildExistingValues(
  asset: AssetRow,
  resolvedValues: Record<string, unknown>,
  labelByFieldId: Record<string, string>
): Record<string, unknown> {
  const existing: Record<string, unknown> = {};
  for (const fieldId of Object.keys(resolvedValues)) {
    const label = labelByFieldId[fieldId] ?? fieldId;
    existing[label] = asset.propertyValues?.[fieldId] ?? null;
  }
  return existing;
}

async function executeImport(
  toolResult: ToolResult,
  _params: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const preview = toolResult.data as UpdateRowPreview | undefined;
  if (!preview || !preview.assetId) {
    return { success: false, error: 'No preview data available to update.' };
  }

  try {
    const [properties, assets] = await Promise.all([
      getLibraryProperties(ctx.supabase, preview.libraryId, ctx),
      getLibraryAssets(ctx.supabase, preview.libraryId, ctx),
    ]);
    await removeUnusedDefaultIdField(
      ctx.supabase,
      preview.libraryId,
      properties,
      assets,
      preview.resolvedValues
    );
    await updateAssetService(ctx.supabase, preview.assetId, preview.assetName, preview.resolvedValues);
    scheduleReindexForAssetFields(
      ctx.supabase,
      ctx.projectId,
      preview.assetId,
      Object.keys(preview.resolvedValues)
    );
    return {
      success: true,
      displayHint: 'text',
      data: {
        assetId: preview.assetId,
        rowIndex: preview.rowIndex,
        libraryId: preview.libraryId,
        libraryName: preview.libraryName,
        changes: preview.changes,
        existingValues: preview.existingValues,
        changeSummary: preview.changes.map((change) => ({
          field: change.field,
          from: preview.existingValues[change.field] ?? null,
          to: change.value,
        })),
      },
      invalidations: [{ type: 'library', id: preview.libraryId }],
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to update row.' };
  }
}

export const updateRow: AgentTool = {
  name: 'update_row',
  description:
    'Update a row identified by its 1-based UI row number (rowIndex). Use this when the user refers to a row by position ("row 1", "row 3") — it targets the exact table row even when its cells are blank. Params: libraryName (optional, defaults to active library), rowIndex (required), propertyValues (semantic field names).',
  category: 'write',
  confirmationMode: 'post_preview',
  confirmationPolicy: 'mode',
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
        description: '1-based UI row number to update (1 = topmost row).',
      },
      propertyValues: {
        type: 'object',
        description: 'Field values to set, keyed by semantic field name.',
        additionalProperties: true,
      },
    },
    required: ['rowIndex', 'propertyValues'],
  },
  execute,
  executeImport,
};
