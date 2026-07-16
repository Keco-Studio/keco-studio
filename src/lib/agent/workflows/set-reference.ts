/**
 * set_reference — skill that writes cross-library references from every non-empty
 * cell of a source library into a target row's reference field.
 *
 * Code-orchestrated composite tool (post_preview confirmation):
 * - execute()       NON-MUTATING. Reads the source library, builds one reference
 *                   selection per non-empty cell, validates the target reference
 *                   field, and returns a preview (displayHint: 'skill_preview').
 * - executeImport() MUTATING. Writes the previewed selections via updateAsset.
 *
 * Produces one reference chip per non-empty cell (not per row), eliminating the
 * "incomplete references" failure.
 */

import { z } from 'zod';
import { updateAsset as updateAssetService } from '@/lib/services/libraryAssetsService';
import { sortAssetsForUiRow, type ReferenceFieldLite } from '@/lib/utils/assetEmptiness';
import {
  referenceSelectionsToValue,
  type ReferenceSelection,
} from '@/lib/utils/referenceValue';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import { buildLibraryReferenceSelections } from '../asset-emptiness';
import { getLibraryAssets, getLibraryProperties } from '../data-access';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { errorFromLookupResult, libraryFromLookupResult, resolveLibraryForTool } from '../tools/_shared';

const ParamsSchema = z.object({
  sourceLibrary: z.string().min(1),
  targetLibrary: z.string().min(1).optional(),
  targetRow: z.number().int().positive(),
  targetField: z.string().min(1),
});

interface SetReferencePreviewItem {
  assetId: string;
  fieldId: string;
  fieldLabel: string;
  displayValue: string;
  rowIndex: number;
}

interface SetReferencePreview {
  type: 'set_reference';
  sourceLibrary: string;
  targetLibrary: string;
  targetLibraryId: string;
  targetRow: number;
  targetField: string;
  targetFieldId: string;
  targetAssetId: string;
  targetAssetName: string;
  references: SetReferencePreviewItem[];
  referenceCount: number;
}

const norm = (s: string) => s.trim().toLowerCase();

function findFieldByName(
  properties: PropertyConfig[],
  fieldName: string
): PropertyConfig | undefined {
  return (
    properties.find((p) => p.key === fieldName) ??
    properties.find((p) => p.name === fieldName) ??
    properties.find((p) => norm(p.name) === norm(fieldName))
  );
}

function toReferenceFields(properties: PropertyConfig[]): ReferenceFieldLite[] {
  return properties.map((p) => ({ id: p.key, label: p.name, orderIndex: p.orderIndex }));
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    return await executeSetReference(params, ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to set references.';
    return { success: false, error: message };
  }
}

async function executeSetReference(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const { sourceLibrary, targetRow, targetField } = parsed.data;
  const targetLibraryName = parsed.data.targetLibrary ?? ctx.currentLibraryName;
  if (!targetLibraryName) {
    return {
      success: false,
      error: 'No target library specified. Ask the user, or navigate to a library page first.',
    };
  }

  const sourceResult = await resolveLibraryForTool(ctx.supabase, ctx.projectId, sourceLibrary, ctx);
  const sourceLookupError = errorFromLookupResult(sourceResult);
  if (sourceLookupError !== undefined) {
    return { success: false, error: `Source library error: ${sourceLookupError}` };
  }
  const source = libraryFromLookupResult(sourceResult);

  const targetResult = await resolveLibraryForTool(ctx.supabase, ctx.projectId, targetLibraryName, ctx);
  const targetLookupError = errorFromLookupResult(targetResult);
  if (targetLookupError !== undefined) {
    return { success: false, error: `Target library error: ${targetLookupError}` };
  }
  const target = libraryFromLookupResult(targetResult);

  // Build reference selections from every non-empty source cell.
  const [sourceProperties, sourceAssets] = await Promise.all([
    getLibraryProperties(ctx.supabase, source.id, ctx),
    getLibraryAssets(ctx.supabase, source.id, ctx),
  ]);
  const references = buildLibraryReferenceSelections(sourceAssets, toReferenceFields(sourceProperties));
  if (references.length === 0) {
    return {
      success: false,
      error: `Source library "${source.name}" has no non-empty rows. Nothing to reference.`,
    };
  }

  // Validate the target reference field.
  const targetProperties = await getLibraryProperties(ctx.supabase, target.id, ctx);
  const targetProperty = findFieldByName(targetProperties, targetField);
  if (!targetProperty) {
    const available = targetProperties.map((p) => p.name).join(', ') || '(none)';
    return {
      success: false,
      error: `Field "${targetField}" not found in library "${target.name}". Available: ${available}`,
    };
  }
  if (targetProperty.dataType !== 'reference') {
    return {
      success: false,
      error: `Field "${targetField}" is not a reference field (type: ${targetProperty.dataType ?? 'unknown'}). Cannot set references.`,
    };
  }
  const referenceLibraries = targetProperty.referenceLibraries ?? [];
  if (!referenceLibraries.includes(source.id)) {
    return {
      success: false,
      error: `Field "${targetField}" does not reference library "${source.name}". It references library ids: ${referenceLibraries.join(', ') || '(none)'}`,
    };
  }

  // Resolve the target row.
  const targetAssets = sortAssetsForUiRow(
    await getLibraryAssets(ctx.supabase, target.id, ctx)
  );
  if (targetRow > targetAssets.length) {
    return {
      success: false,
      error: `Row ${targetRow} does not exist in library "${target.name}" (library has ${targetAssets.length} row${targetAssets.length === 1 ? '' : 's'}).`,
    };
  }
  const targetAsset = targetAssets[targetRow - 1];

  const previewReferences: SetReferencePreviewItem[] = references.map((r) => ({
    assetId: r.assetId,
    fieldId: r.fieldId ?? '',
    fieldLabel: r.fieldLabel ?? '',
    displayValue: r.displayValue ?? '',
    rowIndex: r.rowIndex,
  }));

  const preview: SetReferencePreview = {
    type: 'set_reference',
    sourceLibrary: source.name,
    targetLibrary: target.name,
    targetLibraryId: target.id,
    targetRow,
    targetField: targetProperty.name,
    targetFieldId: targetProperty.key,
    targetAssetId: targetAsset.id,
    targetAssetName: targetAsset.name,
    references: previewReferences,
    referenceCount: previewReferences.length,
  };

  return { success: true, displayHint: 'skill_preview', data: preview };
}

async function executeImport(
  toolResult: ToolResult,
  _params: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const preview = toolResult.data as SetReferencePreview | undefined;
  if (!preview || !preview.targetAssetId || !preview.targetFieldId) {
    return { success: false, error: 'No preview data available to set references.' };
  }

  const selections: ReferenceSelection[] = preview.references.map((r) => ({
    assetId: r.assetId,
    fieldId: r.fieldId,
    fieldLabel: r.fieldLabel,
    displayValue: r.displayValue,
  }));

  try {
    await updateAssetService(ctx.supabase, preview.targetAssetId, preview.targetAssetName, {
      [preview.targetFieldId]: referenceSelectionsToValue(selections),
    });
    return {
      success: true,
      displayHint: 'text',
      data: {
        targetAssetId: preview.targetAssetId,
        targetLibrary: preview.targetLibrary,
        targetRow: preview.targetRow,
        targetField: preview.targetField,
        referenceCount: preview.referenceCount,
      },
      invalidations: [{ type: 'library', id: preview.targetLibraryId }],
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to set references.' };
  }
}

export const setReference: AgentTool = {
  name: 'set_reference',
  description:
    'Write cross-library references from every non-empty cell of a source library into a target row\'s reference field. Produces one reference chip per non-empty source cell. Use this instead of manually querying the source and writing UUIDs. Params: sourceLibrary (required), targetLibrary (optional, defaults to active library), targetRow (1-based, required), targetField (reference field name, required).',
  category: 'write',
  confirmationMode: 'post_preview',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      sourceLibrary: {
        type: 'string',
        description: 'Library to read reference targets from (all non-empty cells).',
      },
      targetLibrary: {
        type: 'string',
        description: 'Library to write references into. Omit to use the active library.',
      },
      targetRow: {
        type: 'number',
        description: '1-based UI row number in the target library to write into.',
      },
      targetField: {
        type: 'string',
        description: 'Name of the reference field in the target library.',
      },
    },
    required: ['sourceLibrary', 'targetRow', 'targetField'],
  },
  execute,
  executeImport,
};
