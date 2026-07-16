/**
 * setup_library — skill that creates a library together with all of its fields
 * (columns), grouped into sections, in one step.
 *
 * Code-orchestrated composite tool (post_preview confirmation):
 * - execute()       NON-MUTATING. Resolves the folder, checks for a duplicate
 *                   library name, validates every field's data type, resolves
 *                   reference-library names to UUIDs, groups fields by section
 *                   and returns a preview (displayHint: 'skill_preview').
 * - executeImport() MUTATING. Creates the library, then inserts each field. If a
 *                   field fails midway the freshly created library is rolled back.
 */

import { z } from 'zod';
import { addLibraryField } from '@/lib/services/libraryAssetsService';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import { normalizeFieldDataType, SUPPORTED_FIELD_DATA_TYPES } from '../field-data-type';
import { buildDataTypeParamDescription } from '../field-type-catalog';
import {
  createLibraryServer,
  deleteLibraryServer,
  findFolderByName,
  getLibraryProperties,
  listProjectLibraries,
  findLibraryByName,
} from '../data-access';
import { buildLibraryWriteGuide } from '../library-schema-builder';
import { scheduleLibrarySchemaReindex } from '../embedding-index';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const DEFAULT_SECTION = 'section1';

const FieldSchema = z.object({
  label: z.string().min(1),
  dataType: z.string().min(1),
  section: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  enumOptions: z.array(z.string()).optional(),
  referenceLibraries: z.array(z.string()).optional(),
  formulaExpression: z.string().optional(),
});

const ParamsSchema = z.object({
  libraryName: z.string().min(1),
  folderName: z.string().min(1).optional(),
  description: z.string().optional(),
  fields: z.array(FieldSchema).min(1, 'At least one field is required.'),
});

export type SetupFieldInput = z.infer<typeof FieldSchema>;

/** A field after data-type normalization and reference-library resolution. */
interface ResolvedField {
  label: string;
  dataType: PropertyConfig['dataType'];
  section: string;
  description?: string;
  required?: boolean;
  enumOptions?: string[];
  /** Reference library display names (for the preview). */
  referenceLibraries?: string[];
  /** Reference library UUIDs (for the import step). */
  referenceLibraryIds?: string[];
  formulaExpression?: string;
}

interface SetupLibraryPreview {
  type: 'setup_library';
  libraryName: string;
  folderId?: string;
  folderName?: string;
  description?: string;
  sections: Record<string, ResolvedField[]>;
  totalFields: number;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Group fields by their section, preserving the order in which sections and
 * fields first appear. Fields without a section default to "section1".
 */
export function groupFieldsBySection<T extends { section?: string }>(
  fields: T[]
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const field of fields) {
    const sectionName = field.section?.trim() || DEFAULT_SECTION;
    if (!grouped[sectionName]) {
      grouped[sectionName] = [];
    }
    grouped[sectionName].push(field);
  }
  return grouped;
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const { libraryName, folderName, description, fields } = parsed.data;

  try {
    // 1. Resolve folder (optional).
    let folderId: string | undefined;
    let resolvedFolderName: string | undefined;
    if (folderName) {
      const { folder, available } = await findFolderByName(
        ctx.supabase,
        ctx.projectId,
        folderName,
        ctx
      );
      if (!folder) {
        return {
          success: false,
          error: `Folder "${folderName}" not found. Available folders: ${available.join(', ') || '(none)'}`,
        };
      }
      folderId = folder.id;
      resolvedFolderName = folder.name;
    }

    // 2. Reject duplicate library name.
    const existing = await listProjectLibraries(ctx.supabase, ctx.projectId, ctx);
    if (existing.some((lib) => norm(lib.name) === norm(libraryName))) {
      return {
        success: false,
        error: `Library "${libraryName.trim()}" already exists in this project.`,
      };
    }

    // 3. Validate data types + 4. resolve reference libraries.
    const resolvedFields: ResolvedField[] = [];
    for (const field of fields) {
      const dataType = normalizeFieldDataType(field.dataType);
      if (!dataType) {
        return {
          success: false,
          error: `Unsupported data type "${field.dataType}". Supported: ${SUPPORTED_FIELD_DATA_TYPES.join(', ')}`,
        };
      }

      let referenceLibraries: string[] | undefined;
      let referenceLibraryIds: string[] | undefined;
      if (dataType === 'reference' && field.referenceLibraries && field.referenceLibraries.length > 0) {
        referenceLibraries = [];
        referenceLibraryIds = [];
        for (const refName of field.referenceLibraries) {
          const { library, available } = await findLibraryByName(
            ctx.supabase,
            ctx.projectId,
            refName,
            undefined,
            ctx
          );
          if (!library) {
            return {
              success: false,
              error: `Reference library "${refName}" not found. Available: ${available.join(', ') || '(none)'}`,
            };
          }
          referenceLibraries.push(library.name);
          referenceLibraryIds.push(library.id);
        }
      }

      resolvedFields.push({
        label: field.label.trim(),
        dataType,
        section: field.section?.trim() || DEFAULT_SECTION,
        description: field.description,
        required: field.required,
        enumOptions: field.enumOptions,
        referenceLibraries,
        referenceLibraryIds,
        formulaExpression: field.formulaExpression,
      });
    }

    // 5. Group by section.
    const sections = groupFieldsBySection(resolvedFields);

    // 6. Build preview.
    const preview: SetupLibraryPreview = {
      type: 'setup_library',
      libraryName: libraryName.trim(),
      folderId,
      folderName: resolvedFolderName,
      description,
      sections,
      totalFields: resolvedFields.length,
    };

    return { success: true, displayHint: 'skill_preview', data: preview };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to prepare library setup.' };
  }
}

async function executeImport(
  toolResult: ToolResult,
  _params: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const preview = toolResult.data as SetupLibraryPreview | undefined;
  if (!preview || !preview.libraryName) {
    return { success: false, error: 'No preview data available to set up the library.' };
  }

  let libraryId: string;
  try {
    libraryId = await createLibraryServer(
      ctx.supabase,
      ctx.projectId,
      preview.libraryName,
      preview.folderId,
      preview.description
    );
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to create library.' };
  }

  try {
    for (const [sectionName, sectionFields] of Object.entries(preview.sections)) {
      const sectionId = `${libraryId}:${sectionName}`;
      for (const field of sectionFields) {
        await addLibraryField(ctx.supabase, libraryId, sectionId, sectionName, {
          label: field.label,
          dataType: field.dataType,
          description: field.description,
          required: field.required,
          enumOptions: field.enumOptions,
          referenceLibraries: field.referenceLibraryIds,
          formulaExpression: field.formulaExpression,
        });
      }
    }
  } catch (e) {
    // Rollback: the library was just created (no user data yet), so delete it to
    // avoid leaving a half-created schema behind.
    let rollbackNote = '';
    try {
      await deleteLibraryServer(ctx.supabase, libraryId);
    } catch (rollbackError) {
      rollbackNote = ` Rollback also failed: ${(rollbackError as Error).message}. Library "${preview.libraryName}" may need manual cleanup.`;
    }
    return {
      success: false,
      error: `Failed to create fields for library "${preview.libraryName}": ${(e as Error).message}.${rollbackNote}`,
    };
  }

  const properties = await getLibraryProperties(ctx.supabase, libraryId, ctx);
  const writeGuide = buildLibraryWriteGuide(properties);

  scheduleLibrarySchemaReindex(ctx.supabase, {
    projectId: ctx.projectId,
    libraryId,
  });

  return {
    success: true,
    displayHint: 'text',
    data: {
      libraryId,
      libraryName: preview.libraryName,
      folderName: preview.folderName,
      sections: Object.keys(preview.sections),
      totalFields: preview.totalFields,
      writeGuide,
    },
    invalidations: [{ type: 'library', id: libraryId }],
  };
}

export const setupLibrary: AgentTool = {
  name: 'setup_library',
  description:
    'Create a new library (table) together with all of its fields/columns in one step. Fields can be grouped into sections (tabs). Use this when the user wants a new table with columns; use create_library only for an empty table. Params: libraryName (required), folderName (optional), description (optional), fields (required array; each field needs label and dataType, optionally section, description, required, enumOptions, referenceLibraries, formulaExpression).',
  category: 'write',
  confirmationMode: 'post_preview',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      libraryName: { type: 'string', description: 'New library (table) name' },
      folderName: {
        type: 'string',
        description:
          'Folder name to place the library in. Omit to leave it at project root.',
      },
      description: { type: 'string', description: 'Optional library description' },
      fields: {
        type: 'array',
        description: 'Fields (columns) to create. At least one is required.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Column display name (field label)' },
            dataType: {
              type: 'string',
              description: buildDataTypeParamDescription(),
            },
            section: {
              type: 'string',
              description: 'Section/tab name. Defaults to "section1".',
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
      },
    },
    required: ['libraryName', 'fields'],
  },
  execute,
  executeImport,
};
