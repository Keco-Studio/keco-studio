/**
 * query_assets — read library assets by name / type / tag.
 */

import { z } from 'zod';
import {
  applyQueryAssetFilters,
  buildNonEmptyCellEntries,
  buildQueryAssetRows,
  buildQueryAssetSummary,
  buildReferenceTargetsFromAssets,
  filterReferenceTargets,
  sortQueryAssetRowsByRowIndex,
} from '../asset-emptiness';
import { getLibraryAssets } from '../data-access';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import {
  buildFieldLabelMap,
  errorFromLookupResult,
  getLibraryProperties,
  libraryFromLookupResult,
  resolveLibraryForTool,
} from './_shared';

const ParamsSchema = z.object({
  libraryName: z.string().min(1).optional(),
  nameFilter: z.string().optional(),
  type: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
  includeEmpty: z.boolean().optional().default(false),
  rowIndex: z.number().int().positive().optional(),
});

const TYPE_FIELD_LABELS = ['类型', 'type', 'Type'];

function invertLabelMap(labelMap: Record<string, string>): Record<string, string> {
  const inverted: Record<string, string> = {};
  for (const [fieldId, label] of Object.entries(labelMap)) {
    inverted[label] = fieldId;
  }
  return inverted;
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const libraryName = parsed.data.libraryName ?? ctx.currentLibraryName;
  const { nameFilter, type, limit, includeEmpty, rowIndex } = parsed.data;
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

  const properties = await getLibraryProperties(ctx.supabase, library.id, ctx);
  const labelMap = buildFieldLabelMap(properties);
  const labelToFieldId = invertLabelMap(labelMap);
  const assets = await getLibraryAssets(ctx.supabase, library.id, ctx);

  const typeFieldId = properties.find((p) => TYPE_FIELD_LABELS.includes(p.name))?.key;
  const typeFieldLabel = typeFieldId ? labelMap[typeFieldId] : undefined;
  const orderedFieldIds = properties.map((p) => p.key);

  const effectiveIncludeEmpty = rowIndex !== undefined ? true : includeEmpty;
  const allRows = buildQueryAssetRows(assets, labelMap, orderedFieldIds);
  const rows = sortQueryAssetRowsByRowIndex(
    applyQueryAssetFilters(allRows, {
      includeEmpty: effectiveIncludeEmpty,
      rowIndex,
      nameFilter,
      type,
      typeFieldLabel,
      limit,
    })
  );
  const summary = buildQueryAssetSummary(allRows, rows, {
    includeEmpty: effectiveIncludeEmpty,
    rowIndex,
  }, labelToFieldId);
  const nonEmptyCells = buildNonEmptyCellEntries(
    allRows.filter((row) => !row.isEmpty),
    labelToFieldId
  );
  const referenceTargets = filterReferenceTargets(
    buildReferenceTargetsFromAssets(assets, properties.map((p) => ({ key: p.key, name: p.name }))),
    { rowIndex }
  );

  const leadingEmpty = summary.leadingEmptyRowCount ?? 0;
  const llmNote =
    leadingEmpty > 0 && !includeEmpty && rowIndex === undefined
      ? `UI row 1${leadingEmpty > 1 ? `–${leadingEmpty}` : ''} is empty (leadingEmptyRowCount=${leadingEmpty}). create_asset reuses the first empty row; use update_row rowIndex=1..${leadingEmpty} or create_asset to fill from the top. query_assets omitted these rows because includeEmpty=false.`
      : undefined;

  return {
    success: true,
    displayHint: 'table',
    data: {
      libraryId: library.id,
      libraryName: library.name,
      columns: properties.map((p) => p.name),
      summary,
      rowCount: rows.length,
      rows,
      nonEmptyCells,
      /** Use these (not row.id) when writing reference fields — one entry per filled cell. */
      referenceTargets,
      ...(llmNote ? { _llmNote: llmNote } : {}),
    },
  };
}

export const queryAssets: AgentTool = {
  name: 'query_assets',
  description:
    'Query library assets. For reference writes use referenceTargets (assetId+fieldId per cell), NOT row.id. summary.nonEmptyCellCount equals referenceTargets.length. Each row may have multiple cells across sections. Params: libraryName, rowIndex, includeEmpty, nameFilter, type, limit.',
  category: 'read',
  confirmationMode: 'pre_execute', // unused for read tools
  parameters: {
    type: 'object',
    properties: {
      libraryName: {
        type: 'string',
        description: 'Name of the library to query. Omit to use the active library from page context.',
      },
      rowIndex: {
        type: 'number',
        description:
          'Return only the asset at this UI row number (1 = first row in the table). Use when the user says "row 1" / "第一行".',
      },
      nameFilter: { type: 'string', description: 'Optional substring filter on asset name' },
      type: { type: 'string', description: 'Optional value filter on the type field' },
      limit: { type: 'number', description: 'Max rows to return (default all, max 200)' },
      includeEmpty: {
        type: 'boolean',
        description:
          'Include rows with no visible cell data (default false). Not needed when rowIndex is set.',
      },
    },
    required: [],
  },
  execute,
};
