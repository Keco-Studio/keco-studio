/**
 * Script Import Service
 *
 * Converts parsed script text into library rows and stores them in the database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  verifyLibraryCreationPermission,
  verifyDerivedConversationCreationPermission,
} from '@/lib/services/authorizationService';
import {
  resolveDerivedLibraryPlacement,
  type DocumentLibrarySource,
} from '@/lib/services/documentDerivedLibraryService';
import { parseText, scriptLineToRow, SCRIPT_COLUMNS } from '@/lib/script-parser';
import type { StoryDocument } from '@/lib/story-ir/schema';
import type { StoryPlotPlan } from '@/lib/story-plot/schema';
import { compileStoryTable } from '@/lib/story-ir/tableCompiler';
import { getInternalFieldGroupColumns } from '@/lib/library/fieldCompatibility';

const BATCH_SIZE = 200;

export type ImportScriptResult = {
  libraryId: string;
  rowCount: number;
  fieldCount: number;
};

interface ImportTableParams {
  userId: string;
  projectId: string;
  folderId: string | null;
  libraryName: string;
  fileName: string;
  documentSource?: DocumentLibrarySource;
  plotPlan?: StoryPlotPlan;
  dialogueGenerationJobId?: string;
  dialogueGenerationWorkerId?: string;
  dialogueSourceState?: { epoch: number; revision: number; updateIds: string[] };
}

export interface ImportStoryParams extends ImportTableParams {
  document: StoryDocument;
  plotPlan?: StoryPlotPlan;
}

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/**
 * Import a script file as a new library.
 */
export async function importScriptFromFile(
  supabase: SupabaseClient,
  params: {
    userId: string;
    projectId: string;
    folderId: string;
    libraryName: string;
    fileContent: string;
    fileName: string;
    roleMap?: Record<string, { id: string; type: number }>;
  }
): Promise<ImportScriptResult> {
  const { userId, projectId, folderId, libraryName, fileContent, fileName, roleMap } = params;

  const script = parseText(fileContent, roleMap);
  const rows = script.lines.map(scriptLineToRow);
  return importCompiledScript(supabase, {
    userId,
    projectId,
    folderId,
    libraryName,
    fileName,
  }, [...SCRIPT_COLUMNS], rows);
}

export async function importStoryDocument(
  supabase: SupabaseClient,
  params: ImportStoryParams
): Promise<ImportScriptResult> {
  const compiled = compileStoryTable(params.document);
  return importCompiledScript(supabase, params, compiled.columns, compiled.rows);
}

async function importCompiledScript(
  supabase: SupabaseClient,
  params: ImportTableParams,
  columns: string[],
  rows: string[][]
): Promise<ImportScriptResult> {
  const {
    userId,
    projectId,
    folderId,
    libraryName,
    fileName,
    documentSource,
    plotPlan,
    dialogueGenerationJobId,
    dialogueGenerationWorkerId,
    dialogueSourceState,
  } = params;

  if (!documentSource && folderId !== null && !isUuid(folderId)) {
    throw new Error('Invalid folder ID');
  }
  if (dialogueGenerationJobId && (!isUuid(dialogueGenerationJobId) || documentSource?.exportType !== 'script'
    || !dialogueGenerationWorkerId || !dialogueSourceState)) {
    throw new Error('Invalid dialogue generation job provenance');
  }

  if (documentSource?.exportType === 'script') {
    await verifyDerivedConversationCreationPermission(supabase, projectId, userId);
  } else {
    await verifyLibraryCreationPermission(supabase, projectId, userId);
  }

  if (!documentSource && folderId !== null) {
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('id, project_id')
      .eq('id', folderId)
      .single();

    if (folderError || !folder || folder.project_id !== projectId) {
      throw new Error('Folder not found or does not belong to the project');
    }
  }

  const trimmedName = libraryName.trim();
  if (!trimmedName) {
    throw new Error('Library name is required');
  }

  if (rows.length === 0) {
    throw new Error('No valid content found in script');
  }

  const placement = documentSource
    ? await resolveDerivedLibraryPlacement(supabase, projectId, documentSource)
    : null;
  const resolvedFolderId = placement ? placement.folderId : folderId;

  const nameCheckQuery = supabase
    .from('libraries')
    .select('id')
    .eq('project_id', projectId)
    .eq('name', trimmedName);
  const { data: existingLibraries, error: nameCheckError } = resolvedFolderId
    ? await nameCheckQuery.eq('folder_id', resolvedFolderId).limit(1)
    : await nameCheckQuery.is('folder_id', null).limit(1);

  if (nameCheckError) {
    throw new Error(nameCheckError.message || 'Failed to check library name');
  }
  if (existingLibraries && existingLibraries.length > 0) {
    throw new Error(`Library name "${trimmedName}" already exists in this folder`);
  }

  const baseLibraryValues = {
    project_id: projectId,
    folder_id: resolvedFolderId,
    name: trimmedName,
    description: `Imported from ${fileName}`,
    // Only set derived-library columns when exporting from a document.
    // Environments without the migration reject these keys in the schema cache.
    ...(placement
      ? {
          source_document_id: placement.sourceDocumentId,
          document_export_type: placement.documentExportType,
        }
      : {}),
    ...(dialogueGenerationJobId ? { dialogue_generation_job_id: dialogueGenerationJobId } : {}),
    ...(dialogueGenerationJobId ? { dialogue_generation_ready: false } : {}),
    ...(dialogueGenerationJobId ? {
      dialogue_generation_source_epoch: dialogueSourceState!.epoch,
      dialogue_generation_source_revision: dialogueSourceState!.revision,
      dialogue_generation_source_update_ids: dialogueSourceState!.updateIds,
    } : {}),
  };
  let createResult = await supabase
    .from('libraries')
    .insert(plotPlan ? { ...baseLibraryValues, plot_plan: plotPlan } : baseLibraryValues)
    .select('id')
    .single();

  if (plotPlan && isMissingPlotPlanColumnError(createResult.error)) {
    createResult = await supabase
      .from('libraries')
      .insert(baseLibraryValues)
      .select('id')
      .single();
  }

  const { data: createdLibrary, error: createError } = createResult;

  if (createError) {
    if (createError.code === '23505') {
      throw new Error('A library with this name already exists in the project or folder.');
    }
    throw createError;
  }

  const libraryId = createdLibrary.id as string;

  try {
    const result = await insertScriptTable(supabase, libraryId, columns, rows);
    if (dialogueGenerationJobId) {
      const finalized = await supabase.rpc('finalize_dialogue_script_import', {
        p_job_id: dialogueGenerationJobId,
        p_worker_id: dialogueGenerationWorkerId,
        p_script_library_id: libraryId,
        p_source_epoch: dialogueSourceState!.epoch,
        p_source_revision: dialogueSourceState!.revision,
        p_source_update_ids: dialogueSourceState!.updateIds,
      });
      if (finalized.error) throw finalized.error;
      if (finalized.data !== true) throw new Error('Dialogue Script import lost its finalization fence.');
    }
    return result;
  } catch (error) {
    let cleanupFailure: unknown;
    try {
      const cleanupQuery = supabase.from('libraries').delete().eq('id', libraryId);
      const cleanup = dialogueGenerationJobId
        ? await cleanupQuery.eq('dialogue_generation_job_id', dialogueGenerationJobId).eq('dialogue_generation_ready', false)
        : await cleanupQuery;
      if (cleanup.error) {
        cleanupFailure = cleanup.error;
      }
    } catch (cleanupError) {
      cleanupFailure = cleanupError;
    }
    if (cleanupFailure) {
      const originalMessage = error instanceof Error ? error.message : 'Dialogue Script import failed.';
      const cleanupMessage = cleanupFailure instanceof Error
        ? cleanupFailure.message
        : typeof cleanupFailure === 'object' && cleanupFailure && 'message' in cleanupFailure
          ? String(cleanupFailure.message)
          : 'unknown cleanup error';
      throw new Error(`${originalMessage}; cleanup failed: ${cleanupMessage}`);
    }
    throw error;
  }
}

function isMissingPlotPlanColumnError(
  error: { code?: string; message?: string } | null
): boolean {
  return error?.code === 'PGRST204'
    && /plot_plan/i.test(error.message ?? '');
}

async function insertScriptTable(
  supabase: SupabaseClient,
  libraryId: string,
  columns: string[],
  rows: string[][]
): Promise<ImportScriptResult> {

  const fieldRows = columns.map((label, colIdx) => ({
    library_id: libraryId,
    ...getInternalFieldGroupColumns(libraryId),
    label,
    description: null,
    data_type: 'string',
    formula_expression: null,
    required: false,
    order_index: colIdx,
    enum_options: null,
    reference_libraries: null,
  }));

  const { data: insertedFields, error: fieldError } = await supabase
    .from('library_field_definitions')
    .insert(fieldRows)
    .select('id, order_index');

  if (fieldError) throw fieldError;

  if (!insertedFields || insertedFields.length !== columns.length) {
    throw new Error('Failed to create script fields');
  }

  const fieldIdsByColumn = new Map<string, string>();
  insertedFields.forEach((inserted) => {
    fieldIdsByColumn.set(String(inserted.order_index), inserted.id);
  });
  const fieldCount = insertedFields.length;

  let rowCount = 0;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batchEnd = Math.min(start + BATCH_SIZE, rows.length);
    const assetRows = [];

    for (let rowIdx = start; rowIdx < batchEnd; rowIdx++) {
      const row = rows[rowIdx];
      const assetName = (row[0] || row[3] || `Row ${rowIdx + 1}`).slice(0, 100) || `Row ${rowIdx + 1}`;
      assetRows.push({
        library_id: libraryId,
        name: assetName,
        row_index: rowIdx,
      });
    }

    const { data: insertedAssets, error: assetError } = await supabase
      .from('library_assets')
      .insert(assetRows)
      .select('id');

    if (assetError) throw assetError;

    const valueRows: Array<{ asset_id: string; field_id: string; value_json: string }> = [];
    (insertedAssets ?? []).forEach((asset, batchOffset) => {
      const rowIdx = start + batchOffset;
      const row = rows[rowIdx];

      row.forEach((cell, colIdx) => {
        const fieldId = fieldIdsByColumn.get(String(colIdx));
        if (!fieldId || cell === '') return;
        valueRows.push({
          asset_id: asset.id,
          field_id: fieldId,
          value_json: cell,
        });
      });
    });

    if (valueRows.length > 0) {
      const { error: valuesError } = await supabase.from('library_asset_values').insert(valueRows);
      if (valuesError) throw valuesError;
    }

    rowCount += assetRows.length;
  }

  return {
    libraryId,
    rowCount,
    fieldCount,
  };
}
