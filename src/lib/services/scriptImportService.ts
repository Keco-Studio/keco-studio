/**
 * Script Import Service
 *
 * Converts parsed script text into library rows and stores them in the database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  verifyLibraryCreationPermission,
} from '@/lib/services/authorizationService';
import { parseText, scriptLineToRow, SCRIPT_COLUMNS } from '@/lib/script-parser';

const BATCH_SIZE = 200;
const SCRIPT_SECTION_NAME = 'Section';

export type ImportScriptResult = {
  libraryId: string;
  rowCount: number;
  fieldCount: number;
};

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

  if (!isUuid(folderId)) {
    throw new Error('Invalid folder ID');
  }

  await verifyLibraryCreationPermission(supabase, projectId, userId);

  const { data: folder, error: folderError } = await supabase
    .from('folders')
    .select('id, project_id')
    .eq('id', folderId)
    .single();

  if (folderError || !folder || folder.project_id !== projectId) {
    throw new Error('Folder not found or does not belong to the project');
  }

  const trimmedName = libraryName.trim();
  if (!trimmedName) {
    throw new Error('Library name is required');
  }

  const { data: existingLibraries, error: nameCheckError } = await supabase
    .from('libraries')
    .select('id')
    .eq('project_id', projectId)
    .eq('folder_id', folderId)
    .eq('name', trimmedName)
    .limit(1);

  if (nameCheckError) {
    throw new Error(nameCheckError.message || 'Failed to check library name');
  }
  if (existingLibraries && existingLibraries.length > 0) {
    throw new Error(`Library name "${trimmedName}" already exists in this folder`);
  }

  const script = parseText(fileContent, roleMap);
  const rows = script.lines.map(scriptLineToRow);

  if (rows.length === 0) {
    throw new Error('No valid content found in script');
  }

  const { data: createdLibrary, error: createError } = await supabase
    .from('libraries')
    .insert({
      project_id: projectId,
      folder_id: folderId,
      name: trimmedName,
      description: `Imported from ${fileName}`,
    })
    .select('id')
    .single();

  if (createError) {
    if (createError.code === '23505') {
      throw new Error('A library with this name already exists in the project or folder.');
    }
    throw createError;
  }

  const libraryId = createdLibrary.id as string;

  const fieldRows = SCRIPT_COLUMNS.map((label, colIdx) => ({
    library_id: libraryId,
    section_id: `${libraryId}:${SCRIPT_SECTION_NAME}`,
    section: SCRIPT_SECTION_NAME,
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

  if (!insertedFields || insertedFields.length !== SCRIPT_COLUMNS.length) {
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
