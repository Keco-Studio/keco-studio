/**
 * get_library_schema — read-only skill returning a library's full write contract.
 *
 * Gives the agent per-table schema (columns, required, enum options, reference
 * targets, value formats, primary label column, row count, and a write example)
 * before create_asset / update_row calls.
 */

import { z } from 'zod';
import { getLibraryAssets, getLibraryProperties } from '../data-access';
import { buildLibrarySchemaData } from '../library-schema-builder';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { isAssetEmptyForDisplay } from '@/lib/utils/assetEmptiness';
import {
  errorFromLookupResult,
  libraryFromLookupResult,
  resolveLibraryForTool,
} from '../tools/_shared';

const ParamsSchema = z.object({
  libraryName: z.string().min(1).optional(),
});

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

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

  const [properties, assets] = await Promise.all([
    getLibraryProperties(ctx.supabase, library.id, ctx),
    getLibraryAssets(ctx.supabase, library.id, ctx),
  ]);

  const rowCount = assets.filter(
    (asset) => !isAssetEmptyForDisplay(asset.propertyValues ?? {})
  ).length;

  return {
    success: true,
    displayHint: 'list',
    data: buildLibrarySchemaData(library.id, library.name, properties, rowCount),
  };
}

export const getLibrarySchema: AgentTool = {
  name: 'get_library_schema',
  description:
    'Return the full write contract for a library (table): columns, data types, required flags, ' +
    'enum legal values, reference target libraries, value formats, primary label column, current ' +
    'non-empty row count, and an example propertyValues object. Call this BEFORE filling a table ' +
    'that was not just created by setup_library. Params: libraryName (optional — defaults to active library).',
  category: 'read',
  confirmationMode: 'pre_execute',
  parameters: {
    type: 'object',
    properties: {
      libraryName: {
        type: 'string',
        description: 'Library (table) name. Defaults to the active library from context.',
      },
    },
    required: [],
  },
  execute,
};
