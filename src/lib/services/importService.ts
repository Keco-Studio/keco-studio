import type { SupabaseClient } from '@supabase/supabase-js';
import {
  verifyLibraryCreationPermission,
} from '@/lib/services/authorizationService';
import { parseWorkbookRows } from '@/lib/utils/workbook';

const BATCH_SIZE = 200;

export type ImportSectionData = {
  name: string;
  columns: string[];
  rows: string[][];
};

export type ParsedImportFile = {
  sections: ImportSectionData[];
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Strip optional "Label (dataType)" suffix from exported headers. */
export function parseHeaderLabel(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s*\(\w+(?:_\w+)*\)$/);
  return match ? match[1].trim() : trimmed;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function normalizeColumns(rawHeaders: unknown[]): string[] {
  const used = new Set<string>();
  return rawHeaders.map((header, index) => {
    let label = parseHeaderLabel(cellToString(header));
    if (!label) label = `Column ${index + 1}`;
    let candidate = label;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${label} (${suffix})`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function rowsToSection(rows: unknown[][], sectionName: string): ImportSectionData | null {
  if (rows.length === 0) return null;

  const headerRow = rows[0] ?? [];
  const columns = normalizeColumns(headerRow);
  if (columns.length === 0) return null;

  const dataRows = rows
    .slice(1)
    .map((row) => columns.map((_, colIdx) => cellToString(row[colIdx])))
    .filter((row) => row.some((cell) => cell.length > 0));

  return { name: sectionName, columns, rows: dataRows };
}

export async function parseImportFile(buffer: Buffer, fileName: string): Promise<ParsedImportFile> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const sheets = await parseWorkbookRows(buffer, fileName);

  if (sheets.length === 0) {
    throw new Error('File has no sheets');
  }

  const sections: ImportSectionData[] = [];
  for (const sheet of sheets) {
    const section = rowsToSection(sheet.rows, sheet.name.trim() || 'Section');
    if (section) sections.push(section);
  }

  if (sections.length === 0) {
    throw new Error('No valid header row found in file');
  }

  // CSV imports use a single default section, matching manually created libraries.
  if (ext === 'csv' && sections.length === 1) {
    sections[0].name = 'Section';
  } else if (ext !== 'csv' && sections.length === 1 && /^sheet1$/i.test(sections[0].name)) {
    sections[0].name = 'Section';
  }

  return { sections };
}

export type ImportLibraryResult = {
  libraryId: string;
  rowCount: number;
  fieldCount: number;
  sectionCount: number;
};


export function parseImportFolderId(raw: FormDataEntryValue | null): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (!isUuid(value)) throw new Error('Invalid folderId');
  return value;
}

export async function importLibraryFromFile(
  supabase: SupabaseClient,
  params: {
    userId: string;
    projectId: string;
    folderId: string | null;
    libraryName: string;
    description?: string | null;
    fileBuffer: Buffer;
    fileName: string;
  }
): Promise<ImportLibraryResult> {
  const { userId, projectId, folderId, libraryName, fileBuffer, fileName } = params;

  if (folderId !== null && !isUuid(folderId)) {
    throw new Error('Invalid folder ID');
  }

  await verifyLibraryCreationPermission(supabase, projectId, userId);

  if (folderId !== null) {
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
  const description = params.description?.trim() || null;
  if (description && description.length > 250) {
    throw new Error('Notes exceed 250 character limit');
  }

  let nameCheckQuery = supabase
    .from('libraries')
    .select('id')
    .eq('project_id', projectId)
    .eq('name', trimmedName)
    .limit(1);
  nameCheckQuery = folderId === null
    ? nameCheckQuery.is('folder_id', null)
    : nameCheckQuery.eq('folder_id', folderId);
  const { data: existingLibraries, error: nameCheckError } = await nameCheckQuery;

  if (nameCheckError) {
    throw new Error(nameCheckError.message || 'Failed to check library name');
  }
  if (existingLibraries && existingLibraries.length > 0) {
    throw new Error(`Library name "${trimmedName}" already exists`);
  }

  const parsed = await parseImportFile(fileBuffer, fileName);

  const { data: createdLibrary, error: createError } = await supabase
    .from('libraries')
    .insert({
      project_id: projectId,
      folder_id: folderId,
      name: trimmedName,
      description,
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

  const fieldIdsBySectionColumn = new Map<string, string>();
  let globalFieldOrder = 0;
  const fieldRows: Array<{
    key: string;
    row: {
      library_id: string;
      section_id: string;
      section: string;
      label: string;
      description: null;
      data_type: 'string';
      formula_expression: null;
      required: false;
      order_index: number;
      enum_options: null;
      reference_libraries: null;
    };
  }> = [];

  for (const section of parsed.sections) {
    const sectionId = `${libraryId}:${section.name}`;
    for (let colIdx = 0; colIdx < section.columns.length; colIdx += 1) {
      const label = section.columns[colIdx];
      fieldRows.push({
        key: `${section.name}:${colIdx}`,
        row: {
          library_id: libraryId,
          section_id: sectionId,
          section: section.name,
          label,
          description: null,
          data_type: 'string',
          formula_expression: null,
          required: false,
          order_index: globalFieldOrder,
          enum_options: null,
          reference_libraries: null,
        },
      });
      globalFieldOrder += 1;
    }
  }

  const { data: insertedFields, error: fieldError } = await supabase
    .from('library_field_definitions')
    .insert(fieldRows.map(({ row }) => row))
    .select('id');

  if (fieldError) throw fieldError;
  if (!insertedFields || insertedFields.length !== fieldRows.length) {
    throw new Error('Failed to create all imported fields');
  }
  fieldRows.forEach(({ key }, index) => {
    fieldIdsBySectionColumn.set(key, insertedFields[index].id);
  });
  const fieldCount = fieldRows.length;

  // One asset per row index; multiple sheets (sections) merge into the same asset row.
  const maxRows = Math.max(...parsed.sections.map((s) => s.rows.length), 0);
  const primarySection = parsed.sections[0];

  let rowCount = 0;
  for (let start = 0; start < maxRows; start += BATCH_SIZE) {
    const batchEnd = Math.min(start + BATCH_SIZE, maxRows);
    const assetRows = [];
    for (let rowIdx = start; rowIdx < batchEnd; rowIdx += 1) {
      const primaryRow = primarySection.rows[rowIdx] ?? [];
      const assetName = (primaryRow[0] ?? '').trim() || 'Untitled';
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
      for (const section of parsed.sections) {
        const rowValues = section.rows[rowIdx] ?? [];
        section.columns.forEach((_, colIdx) => {
          const fieldId = fieldIdsBySectionColumn.get(`${section.name}:${colIdx}`);
          const cell = rowValues[colIdx] ?? '';
          if (!fieldId || cell === '') return;
          valueRows.push({
            asset_id: asset.id,
            field_id: fieldId,
            value_json: cell,
          });
        });
      }
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
    sectionCount: parsed.sections.length,
  };
}
