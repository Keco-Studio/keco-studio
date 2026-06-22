/**
 * add_field — add a new column (field definition) to a library section.
 */

import { z } from 'zod';
import { addLibraryField } from '@/lib/services/libraryAssetsService';
import { scheduleLibrarySchemaReindex } from '../embedding-index';
import { normalizeFieldDataType, SUPPORTED_FIELD_DATA_TYPES } from '../field-data-type';
import { buildDataTypeParamDescription } from '../field-type-catalog';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { errorFromLookupResult, libraryFromLookupResult, resolveLibraryForTool } from './_shared';

const ParamsSchema = z.object({
  libraryName: z.string().min(1).optional(),
  sectionName: z.string().min(1).optional(),
  label: z.string().min(1),
  dataType: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
  enumOptions: z.array(z.string()).optional(),
  referenceLibraries: z.array(z.string()).optional(),
  formulaExpression: z.string().optional(),
});

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

  const libraryName = parsed.data.libraryName ?? ctx.currentLibraryName;
  const sectionName = parsed.data.sectionName ?? ctx.currentSectionName;
  const dataType = normalizeFieldDataType(parsed.data.dataType);

  if (!libraryName) {
    return {
      success: false,
      error: 'No library specified. Ask the user which library, or navigate to a library page first.',
    };
  }
  if (!sectionName) {
    return {
      success: false,
      error: 'No section specified. Ask the user which section tab, or navigate to a library section first.',
    };
  }
  if (!dataType) {
    return {
      success: false,
      error: `Unsupported data type "${parsed.data.dataType}". Supported: ${SUPPORTED_FIELD_DATA_TYPES.join(', ')}`,
    };
  }

  const libraryResult = await resolveLibraryForTool(ctx.supabase, ctx.projectId, libraryName, ctx);
  const libraryLookupError = errorFromLookupResult(libraryResult);
  if (libraryLookupError !== undefined) {
    return { success: false, error: libraryLookupError };
  }
  const library = libraryFromLookupResult(libraryResult);

  // Resolve reference library names → UUIDs (DB column is uuid[]).
  let resolvedReferenceLibraryIds: string[] | undefined;
  if (parsed.data.referenceLibraries && parsed.data.referenceLibraries.length > 0) {
    resolvedReferenceLibraryIds = [];
    for (const refName of parsed.data.referenceLibraries) {
      const refResult = await resolveLibraryForTool(ctx.supabase, ctx.projectId, refName, ctx);
      const refLookupError = errorFromLookupResult(refResult);
      if (refLookupError !== undefined) {
        return { success: false, error: refLookupError };
      }
      resolvedReferenceLibraryIds.push(libraryFromLookupResult(refResult).id);
    }
  }

  const sectionId = `${library.id}:${sectionName}`;

  try {
    const { id: fieldId } = await addLibraryField(
      ctx.supabase,
      library.id,
      sectionId,
      sectionName,
      {
        label: parsed.data.label,
        dataType,
        description: parsed.data.description,
        required: parsed.data.required,
        enumOptions: parsed.data.enumOptions,
        referenceLibraries: resolvedReferenceLibraryIds,
        formulaExpression: parsed.data.formulaExpression,
      }
    );
    scheduleLibrarySchemaReindex(ctx.supabase, {
      projectId: ctx.projectId,
      libraryId: library.id,
    });
    return {
      success: true,
      displayHint: 'text',
      data: {
        fieldId,
        libraryId: library.id,
        libraryName: library.name,
        sectionName,
        label: parsed.data.label.trim(),
        dataType,
      },
      invalidateCache: [library.id],
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to add field.' };
  }
}

export const addField: AgentTool = {
  name: 'add_field',
  description:
    'Add a new column (field) to a library section schema. libraryName and sectionName default to the user\'s active library/section from page context when omitted. Params: label (column name, required), dataType (required, e.g. int, string, boolean), libraryName (optional), sectionName (optional).',
  category: 'write',
  confirmationMode: 'pre_execute',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      libraryName: {
        type: 'string',
        description: 'Target library name. Omit to use the active library from page context.',
      },
      sectionName: {
        type: 'string',
        description: 'Target section tab name. Omit to use the active section from page context.',
      },
      label: { type: 'string', description: 'Column display name (field label)' },
      dataType: {
        type: 'string',
        description: buildDataTypeParamDescription(),
      },
      description: { type: 'string', description: 'Optional field description' },
      required: { type: 'boolean', description: 'Whether the field is required' },
      enumOptions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Allowed values when dataType is enum',
      },
      referenceLibraries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Referenced library names when dataType is reference',
      },
      formulaExpression: {
        type: 'string',
        description: 'Formula expression when dataType is formula',
      },
    },
    required: ['label', 'dataType'],
  },
  execute,
};
