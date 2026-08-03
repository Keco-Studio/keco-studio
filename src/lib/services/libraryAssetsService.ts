import { SupabaseClient } from '@supabase/supabase-js';
import {
  AssetRow,
  LibrarySummary,
  PropertyConfig,
  SectionConfig,
} from '@/lib/types/libraryAssets';
import {
  computeFormulaValueForField,
  computeFormulaValuesForRow,
  createFormulaFieldByName,
} from '@/lib/utils/formula';
import { getLibrary } from '@/lib/services/libraryService';
import { syncReferencesForSourceChanges } from '@/lib/services/referenceSyncService';
import { fetchAllPaged } from '@/lib/services/pagination';
import {
  type AccessVerificationContext,
  verifyLibraryAccess,
  verifyLibraryUpdatePermission,
  verifyAssetAccess,
  verifyAssetDeletionPermission,
  verifyAssetsDeletionPermission,
  verifyAssetCreationPermission,
  verifyAssetUpdatePermission,
} from './authorizationService';

type FieldDefinitionRow = {
  id: string;
  library_id: string;
  section: string;
  label: string;
  description: string | null;
  data_type: 'string' | 'string_array' | 'int' | 'int_array' | 'float' | 'boolean' | 'enum' | 'date' | 'image' | 'file' | 'reference' | 'multimedia' | 'audio' | 'formula';
  enum_options: string[] | null;
  reference_libraries: string[] | null; // Array of library IDs that can be referenced
  formula_expression: string | null;
  required: boolean;
  order_index: number;
};

type AssetRowDb = {
  id: string;
  library_id: string;
  name: string;
  created_at?: string;
  row_index?: number;
};

type AssetValueRow = {
  asset_id: string;
  field_id: string;
  value_json: unknown;
};

type FormulaFieldMetaRow = {
  id: string;
  label: string;
  data_type: string;
  formula_expression: string | null;
};

const isCustomFormulaCellValue = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.trim().startsWith('=');
  }
  if (value && typeof value === 'object') {
    const maybe = value as { customExpression?: unknown; expression?: unknown };
    if (typeof maybe.customExpression === 'string' && maybe.customExpression.trim() !== '') {
      return true;
    }
    if (typeof maybe.expression === 'string' && maybe.expression.trim() !== '') {
      return true;
    }
  }
  return false;
};

const mergeFormulaValuesPreservingCustom = (
  formulaMeta: FormulaFieldMetaRow[],
  propertyValues: Record<string, any>
): Record<string, any> => {
  const computedFormulaValues = computeFormulaValuesForRow(
    formulaMeta.map((f) => ({
      id: f.id,
      name: f.label,
      dataType: f.data_type,
      formulaExpression: f.formula_expression,
    })),
    propertyValues
  );

  const merged: Record<string, any> = { ...propertyValues };
  for (const formulaField of formulaMeta) {
    const fieldId = formulaField.id;
    const inputValue = propertyValues[fieldId];
    if (isCustomFormulaCellValue(inputValue)) {
      // Keep cell-level custom expression as-is; do not overwrite with column-level formula result.
      merged[fieldId] = inputValue;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(computedFormulaValues, fieldId)) {
      merged[fieldId] = computedFormulaValues[fieldId];
    }
  }
  return merged;
};

// Refresh library, folder, and project updated_at metadata after library data
// or schema changes so TopBar search ordering stays current.
async function touchLibraryUpdatedAt(supabase: SupabaseClient, libraryId: string) {
  if (!libraryId) return;
  try {
    const now = new Date().toISOString();

    // Update the library and fetch its parent project/folder in one round trip.
    const { data, error } = await supabase
      .from('libraries')
      .update({ updated_at: now })
      .eq('id', libraryId)
      .select('project_id, folder_id')
      .single();

    if (error) throw error;

    const projectId = (data as any)?.project_id as string | undefined;
    const folderId = (data as any)?.folder_id as string | undefined | null;

    if (projectId) {
      await supabase
        .from('projects')
        .update({ updated_at: now })
        .eq('id', projectId);
    }

    if (folderId) {
      await supabase
        .from('folders')
        .update({ updated_at: now })
        .eq('id', folderId);
    }
  } catch (error) {
    // Do not block the main flow if timestamp metadata fails to update.
    // eslint-disable-next-line no-console
    console.warn('[Libraries] Failed to touch updated_at for library/folder/project', libraryId, error);
  }
}

const mapDataTypeToValueType = (
  dataType: FieldDefinitionRow['data_type']
): PropertyConfig['valueType'] => {
  switch (dataType) {
    case 'string':
      return 'string';
    case 'int':
    case 'float':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return 'enum';
    case 'date':
      return 'string';
    default:
      return 'other';
  }
};

/**
 * Keep field deserialization consistent with LibraryDataContext.loadInitialData:
 * - Supabase jsonb is usually already an object or primitive, so return it directly.
 * - For non-empty strings, try JSON.parse and keep the original string if parsing fails.
 */
const normalizeValue = (input: unknown): any => {
  if (input === null || input === undefined) return null;
  let value = input;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      // Keep JSON objects as strings for plain text fields (e.g. imported params columns).
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        value = parsed;
      }
    } catch {
      // Not a JSON string, so keep it as plain text.
    }
  }
  return value;
};

export async function getBooleanFieldIdsByLibraryId(
  supabase: SupabaseClient,
  libraryId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('library_field_definitions')
    .select('id')
    .eq('library_id', libraryId)
    .eq('data_type', 'boolean');

  if (error) throw error;
  return (data ?? []).map((row) => row.id as string);
}

/** Missing boolean cells default to false (matches table UI and search). */
export function applyBooleanFieldDefaults(
  propertyValues: Record<string, any>,
  booleanFieldIds: string[]
): Record<string, any> {
  if (booleanFieldIds.length === 0) return propertyValues;

  const merged = { ...propertyValues };
  for (const fieldId of booleanFieldIds) {
    const current = merged[fieldId];
    if (current === null || current === undefined || !(fieldId in merged)) {
      merged[fieldId] = false;
    }
  }
  return merged;
}

export async function backfillBooleanFieldDefaults(
  supabase: SupabaseClient,
  libraryId: string,
  fieldId?: string
): Promise<void> {
  const booleanFieldIds = fieldId
    ? [fieldId]
    : await getBooleanFieldIdsByLibraryId(supabase, libraryId);
  if (booleanFieldIds.length === 0) return;

  const { data: assets, error: assetsError } = await supabase
    .from('library_assets')
    .select('id')
    .eq('library_id', libraryId);

  if (assetsError) throw assetsError;
  if (!assets || assets.length === 0) return;

  const assetIds = assets.map((row) => row.id as string);
  const { data: existing, error: existingError } = await supabase
    .from('library_asset_values')
    .select('asset_id, field_id')
    .in('asset_id', assetIds)
    .in('field_id', booleanFieldIds);

  if (existingError) throw existingError;

  const existingKeys = new Set(
    (existing ?? []).map((row) => `${row.asset_id}:${row.field_id}`)
  );

  const rows: Array<{ asset_id: string; field_id: string; value_json: boolean }> = [];
  for (const assetId of assetIds) {
    for (const booleanFieldId of booleanFieldIds) {
      const key = `${assetId}:${booleanFieldId}`;
      if (!existingKeys.has(key)) {
        rows.push({ asset_id: assetId, field_id: booleanFieldId, value_json: false });
      }
    }
  }

  if (rows.length === 0) return;

  const { error: upsertError } = await supabase
    .from('library_asset_values')
    .upsert(rows, { onConflict: 'asset_id,field_id' });

  if (upsertError) throw upsertError;
}

async function getFormulaFieldMetaByLibraryId(
  supabase: SupabaseClient,
  libraryId: string
): Promise<FormulaFieldMetaRow[]> {
  const { data, error } = await supabase
    .from('library_field_definitions')
    .select('id, label, data_type, formula_expression')
    .eq('library_id', libraryId);

  if (error) throw error;
  return (data ?? []) as FormulaFieldMetaRow[];
}

async function getLibraryIdByAssetId(
  supabase: SupabaseClient,
  assetId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('library_assets')
    .select('library_id')
    .eq('id', assetId)
    .single();

  if (error || !data?.library_id) {
    throw error ?? new Error(`Asset ${assetId} not found`);
  }
  return data.library_id as string;
}

async function recalculateAndPersistFormulaFieldValues(
  supabase: SupabaseClient,
  libraryId: string,
  targetFormulaFieldId: string
): Promise<void> {
  const formulaMeta = await getFormulaFieldMetaByLibraryId(supabase, libraryId);
  const assets = await getLibraryAssetsWithProperties(supabase, libraryId);
  if (assets.length === 0) return;

  const evaluableFields = formulaMeta.map((f) => ({
    id: f.id,
    name: f.label,
    dataType: f.data_type,
    formulaExpression: f.formula_expression,
  }));
  const fieldByName = createFormulaFieldByName(evaluableFields);

  const upsertRows: Array<{ asset_id: string; field_id: string; value_json: unknown }> = [];
  for (const asset of assets) {
    const existingTargetValue = asset.propertyValues?.[targetFormulaFieldId];
    if (isCustomFormulaCellValue(existingTargetValue)) {
      // Respect cell-level custom formulas: schema-level recalculation should not overwrite them.
      continue;
    }
    const value = computeFormulaValueForField(
      evaluableFields,
      targetFormulaFieldId,
      asset.propertyValues,
      fieldByName
    );
    // Persist any non-empty result so formulas can return numbers, booleans, or strings.
    if (value !== null && value !== undefined) {
      upsertRows.push({
        asset_id: asset.id,
        field_id: targetFormulaFieldId,
        value_json: value,
      });
    }
  }

  if (upsertRows.length > 0) {
    const { error } = await supabase
      .from('library_asset_values')
      .upsert(upsertRows, { onConflict: 'asset_id,field_id' });
    if (error) throw error;
  }
}

// Small helper for debugging asset mismatches between "current view" and "version snapshots".
// It only logs in non-production environments and prints a compact digest.
function debugLogAssetRows(label: string, rows: AssetRow[]) {
  if (process.env.NODE_ENV === 'production') return;
  try {
    // Log at most first 20 rows to avoid noise
    const digest = rows.slice(0, 20).map((r) => ({
      id: r.id,
      name: r.name,
      created_at: r.created_at,
      propertyKeys: Object.keys(r.propertyValues || {}),
    }));
    // eslint-disable-next-line no-console
    console.log(`[Debug][Assets][${label}] count=${rows.length}`, digest);
  } catch {
    // Swallow any logging errors – never break main logic
  }
}

// T007: Load library summary from existing libraries table / service.
export async function getLibrarySummary(
  supabase: SupabaseClient,
  libraryId: string
): Promise<LibrarySummary> {
  const library = await getLibrary(supabase, libraryId);

  if (!library) {
    throw new Error('Library not found');
  }

  return {
    id: library.id,
    projectId: library.project_id,
    name: library.name,
    description: library.description,
  };
}

// T008: Load predefine schema for a library and aggregate Sections + Properties.
export async function getLibrarySchema(
  supabase: SupabaseClient,
  libraryId: string,
  access?: AccessVerificationContext
): Promise<{
  sections: SectionConfig[];
  properties: PropertyConfig[];
}> {
  // verify library access
  await verifyLibraryAccess(supabase, libraryId, access?.userId, access?.cache);

  const { data, error } = await supabase
    .from('library_field_definitions')
    .select('*')
    .eq('library_id', libraryId)
    .order('section', { ascending: true })
    .order('order_index', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as FieldDefinitionRow[];

  if (rows.length === 0) {
    return { sections: [], properties: [] };
  }

  const sectionsByName = new Map<
    string,
    {
      section: SectionConfig;
      minOrderIndex: number;
    }
  >();

  const properties: PropertyConfig[] = [];

  for (let row of rows) {
    // Migrate legacy 'media' type to 'image' for backward compatibility
    if (row.data_type === 'media' as any) {
      row = { ...row, data_type: 'image' };
    }
    let grouped = sectionsByName.get(row.section);
    if (!grouped) {
      const sectionId = `${row.library_id}:${row.section}`;
      grouped = {
        section: {
          id: sectionId,
          libraryId: row.library_id,
          name: row.section,
          orderIndex: row.order_index,
        },
        minOrderIndex: row.order_index,
      };
      sectionsByName.set(row.section, grouped);
    } else if (row.order_index < grouped.minOrderIndex) {
      grouped.minOrderIndex = row.order_index;
      grouped.section.orderIndex = row.order_index;
    }

    properties.push({
      id: row.id,
      sectionId: grouped.section.id,
      key: row.id, // propertyValues keyed by field definition id
      name: row.label,
      description: row.description,
      valueType: mapDataTypeToValueType(row.data_type),
      dataType: row.data_type,
      referenceLibraries: row.reference_libraries || undefined,
      enumOptions: row.enum_options || undefined,
      formulaExpression: row.formula_expression || undefined,
      required: row.required ?? false,
      orderIndex: row.order_index,
    });
  }

  const sections = Array.from(sectionsByName.values())
    .map((entry) => entry.section)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const sectionOrderIndexById = new Map<string, number>();
  sections.forEach((section, index) => {
    sectionOrderIndexById.set(section.id, index);
  });

  properties.sort((a, b) => {
    const sa = sectionOrderIndexById.get(a.sectionId) ?? 0;
    const sb = sectionOrderIndexById.get(b.sectionId) ?? 0;
    if (sa !== sb) return sa - sb;
    return a.orderIndex - b.orderIndex;
  });

  return { sections, properties };
}

/** Rename a section by updating all matching field definition rows. */
export async function updateSectionName(
  supabase: SupabaseClient,
  sectionId: string,
  newName: string
): Promise<void> {
  const colonIndex = sectionId.indexOf(':');
  if (colonIndex < 0) return;
  const libraryId = sectionId.slice(0, colonIndex);
  const oldName = sectionId.slice(colonIndex + 1);
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return;

  await verifyLibraryUpdatePermission(supabase, libraryId);

  const { error } = await supabase
    .from('library_field_definitions')
    .update({ section: trimmed })
    .eq('library_id', libraryId)
    .eq('section', oldName);

  if (error) throw error;

  await touchLibraryUpdatedAt(supabase, libraryId);
}

/** Ensure a brand-new library has its default section1 / ID field exactly once. */
export async function ensureDefaultLibraryField(
  supabase: SupabaseClient,
  libraryId: string
): Promise<{ fieldId: string; created: boolean }> {
  const sectionId = `${libraryId}:section1`;
  const defaultField = {
    library_id: libraryId,
    section_id: sectionId,
    section: 'section1',
    label: 'ID',
    data_type: 'string',
    order_index: 0,
    required: false,
  };

  const { data: newField, error: fieldErr } = await supabase
    .from('library_field_definitions')
    .insert(defaultField)
    .select('id')
    .single();

  if (!fieldErr && newField?.id) {
    return { fieldId: newField.id as string, created: true };
  }

  if (fieldErr?.code !== '23505') {
    throw fieldErr;
  }

  const { data: existingField, error: existingError } = await supabase
    .from('library_field_definitions')
    .select('id')
    .eq('library_id', libraryId)
    .eq('section_id', sectionId)
    .eq('order_index', 0)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (!existingField?.id) throw fieldErr;

  return { fieldId: existingField.id as string, created: false };
}

/** Add a section by inserting its default field definition row. */
export async function addLibrarySection(
  supabase: SupabaseClient,
  libraryId: string,
  options?: { name?: string }
): Promise<{ sectionId: string; sectionName: string; fieldId: string }> {
  await verifyLibraryUpdatePermission(supabase, libraryId);

  const { data: existingRows } = await supabase
    .from('library_field_definitions')
    .select('section, order_index')
    .eq('library_id', libraryId);

  const existing = (existingRows || []) as { section: string; order_index: number }[];
  const existingSectionNames = new Set(existing.map((r) => r.section));
  const maxOrderIndex = existing.length > 0 ? Math.max(...existing.map((r) => r.order_index)) : -1;
  const nextOrderIndex = maxOrderIndex + 1000;

  let sectionName = (options?.name ?? 'New Section').trim() || 'New Section';
  let counter = 1;
  while (existingSectionNames.has(sectionName)) {
    sectionName = `New Section ${counter}`;
    counter += 1;
  }

  const sectionId = `${libraryId}:${sectionName}`;

  // Match table initialization: create a default ID string field.
  const { data: inserted, error } = await supabase
    .from('library_field_definitions')
    .insert({
      library_id: libraryId,
      section_id: sectionId,
      section: sectionName,
      label: 'ID',
      description: null,
      data_type: 'string',
      required: false,
      order_index: nextOrderIndex,
      enum_options: null,
      reference_libraries: null,
    })
    .select('id')
    .single();

  if (error) throw error;

  await touchLibraryUpdatedAt(supabase, libraryId);
  return { sectionId, sectionName, fieldId: inserted.id as string };
}

/**
 * Delete a section by removing all field definitions for that section name.
 * Asset values cascade via foreign keys. Matches client section ids (`libraryId:sectionName`).
 */
export async function deleteLibrarySection(
  supabase: SupabaseClient,
  sectionId: string
): Promise<void> {
  const colonIndex = sectionId.indexOf(':');
  if (colonIndex < 0) {
    throw new Error('Invalid section id');
  }
  const libraryId = sectionId.slice(0, colonIndex);
  const sectionName = sectionId.slice(colonIndex + 1);
  if (!libraryId || !sectionName) {
    throw new Error('Invalid section id');
  }

  await verifyLibraryUpdatePermission(supabase, libraryId);

  const { data: existingRows, error: fetchError } = await supabase
    .from('library_field_definitions')
    .select('section')
    .eq('library_id', libraryId);

  if (fetchError) throw fetchError;

  const distinctSections = new Set(
    ((existingRows || []) as { section: string }[]).map((row) => row.section)
  );
  if (!distinctSections.has(sectionName)) {
    throw new Error('Section not found');
  }
  if (distinctSections.size <= 1) {
    throw new Error('Cannot delete the last section');
  }

  const { error } = await supabase
    .from('library_field_definitions')
    .delete()
    .eq('library_id', libraryId)
    .eq('section', sectionName);

  if (error) throw error;

  await touchLibraryUpdatedAt(supabase, libraryId);
}

/** Add one field under the target section for the in-table Add Column modal. */
export async function addLibraryField(
  supabase: SupabaseClient,
  libraryId: string,
  _sectionId: string,
  sectionName: string,
  payload: {
    label: string;
    dataType: PropertyConfig['dataType'];
    description?: string;
    required?: boolean;
    enumOptions?: string[];
    referenceLibraries?: string[];
    formulaExpression?: string;
  }
): Promise<{ id: string }> {
  await verifyLibraryUpdatePermission(supabase, libraryId);

  const { data: existingRows, error: fetchError } = await supabase
    .from('library_field_definitions')
    .select('section_id, order_index')
    .eq('library_id', libraryId)
    .eq('section', sectionName)
    .order('order_index', { ascending: false });

  if (fetchError) throw fetchError;
  const existing = (existingRows || []) as { section_id: string; order_index: number }[];
  const nextOrderIndex = existing.length > 0 ? existing[0].order_index + 1 : 0;
  const dbSectionId =
    existing.length > 0 ? existing[0].section_id : `${libraryId}:${sectionName}`;

  const enumOptions =
    payload.dataType === 'enum'
      ? (payload.enumOptions ?? []).map((v) => v.trim()).filter((v) => v.length > 0)
      : null;

  const referenceLibraries =
    payload.dataType === 'reference'
      ? (payload.referenceLibraries ?? [])
      : null;

  const { data: inserted, error } = await supabase
    .from('library_field_definitions')
    .insert({
      library_id: libraryId,
      section_id: dbSectionId,
      section: sectionName,
      label: payload.label.trim(),
      description: payload.description?.trim() || null,
      data_type: payload.dataType ?? 'string',
      formula_expression: payload.dataType === 'formula' ? (payload.formulaExpression?.trim() || null) : null,
      required: payload.required ?? false,
      order_index: nextOrderIndex,
      enum_options: enumOptions,
      reference_libraries: referenceLibraries,
    })
    .select('id')
    .single();

  if (error) throw error;

  if (payload.dataType === 'formula') {
    await recalculateAndPersistFormulaFieldValues(supabase, libraryId, inserted.id);
  }

  if (payload.dataType === 'boolean') {
    await backfillBooleanFieldDefaults(supabase, libraryId, inserted.id);
  }

  await touchLibraryUpdatedAt(supabase, libraryId);
  return { id: inserted.id };
}

/** Delete one field; database foreign keys cascade deletion of that field's values. */
export async function deleteLibraryField(
  supabase: SupabaseClient,
  libraryId: string,
  fieldId: string
): Promise<void> {
  await verifyLibraryUpdatePermission(supabase, libraryId);

  const { error } = await supabase
    .from('library_field_definitions')
    .delete()
    .eq('library_id', libraryId)
    .eq('id', fieldId);

  if (error) {
    throw new Error(error.message);
  }

  await touchLibraryUpdatedAt(supabase, libraryId);
}

/** Update one field's basic metadata and type configuration. */
export async function updateLibraryField(
  supabase: SupabaseClient,
  libraryId: string,
  fieldId: string,
  payload: {
    label: string;
    dataType: PropertyConfig['dataType'];
    description?: string;
    enumOptions?: string[];
    referenceLibraries?: string[];
    formulaExpression?: string;
  }
): Promise<void> {
  await verifyLibraryUpdatePermission(supabase, libraryId);

  const enumOptions =
    payload.dataType === 'enum'
      ? (payload.enumOptions ?? []).map((v) => v.trim()).filter((v) => v.length > 0)
      : null;

  const referenceLibraries =
    payload.dataType === 'reference'
      ? (payload.referenceLibraries ?? [])
      : null;

  const { error } = await supabase
    .from('library_field_definitions')
    .update({
      label: payload.label.trim(),
      description: payload.description?.trim() || null,
      data_type: payload.dataType ?? 'string',
      formula_expression: payload.dataType === 'formula' ? (payload.formulaExpression?.trim() || null) : null,
      enum_options: enumOptions,
      reference_libraries: referenceLibraries,
    })
    .eq('library_id', libraryId)
    .eq('id', fieldId);

  if (error) {
    throw new Error(error.message);
  }

  if (payload.dataType === 'formula') {
    await recalculateAndPersistFormulaFieldValues(supabase, libraryId, fieldId);
  }

  await touchLibraryUpdatedAt(supabase, libraryId);
}

// T009: Load assets and property values for a library and aggregate into AssetRow[].
export async function getLibraryAssetsWithProperties(
  supabase: SupabaseClient,
  libraryId: string,
  access?: AccessVerificationContext
): Promise<AssetRow[]> {
  // verify library access
  await verifyLibraryAccess(supabase, libraryId, access?.userId, access?.cache);

  const assets = await fetchAllPaged<AssetRowDb>((from, to) =>
    supabase
      .from('library_assets')
      .select('id, library_id, name, created_at, row_index')
      .eq('library_id', libraryId)
      // Keep this ordering identical to frontend allAssets sorting.
      .order('row_index', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  );

  if (assets.length === 0) {
    return [];
  }

  const assetIds = assets.map((a) => a.id);

  const values = await fetchAllPaged<AssetValueRow>((from, to) =>
    supabase
      .from('library_asset_values')
      .select('asset_id, field_id, value_json')
      .in('asset_id', assetIds)
      .order('asset_id', { ascending: true })
      .order('field_id', { ascending: true })
      .range(from, to)
  );

  const rowsByAssetId = new Map<string, AssetRow>();

  for (const asset of assets) {
    rowsByAssetId.set(asset.id, {
      id: asset.id,
      libraryId: asset.library_id,
      name: asset.name,
      slug: null,
      figmaNodeId: null,
      propertyValues: {},
      created_at: asset.created_at,
      rowIndex: asset.row_index ?? undefined,
    });
  }

  for (const value of values) {
    const row = rowsByAssetId.get(value.asset_id);
    if (!row) continue;
    row.propertyValues[value.field_id] = normalizeValue(value.value_json);
  }
  const result = Array.from(rowsByAssetId.values());
  debugLogAssetRows('getLibraryAssetsWithProperties', result);
  return result;
}

// T010: Create a new asset with property values
export async function createAsset(
  supabase: SupabaseClient,
  libraryId: string,
  assetName: string,
  propertyValues: Record<string, any>,
  options?: {
    createdAt?: Date; // Optional: set created_at to control insertion position
    rowIndex?: number; // Optional: explicit row_index
  }
): Promise<string> {
  // verify creation permission (admin and editor can create)
  await verifyAssetCreationPermission(supabase, libraryId);

  const [formulaMeta, booleanFieldIds] = await Promise.all([
    getFormulaFieldMetaByLibraryId(supabase, libraryId),
    getBooleanFieldIdsByLibraryId(supabase, libraryId),
  ]);
  const mergedPropertyValues = applyBooleanFieldDefaults(
    mergeFormulaValuesPreservingCustom(formulaMeta, propertyValues),
    booleanFieldIds
  );

  // Step 1: Insert the asset
  const insertData: {
    library_id: string;
    name: string;
    created_at?: string;
    row_index?: number;
  } = {
    library_id: libraryId,
    name: assetName,
  };

  // If createdAt is provided, use it to control insertion position
  if (options?.createdAt) {
    insertData.created_at = options.createdAt.toISOString();
  }
  if (typeof options?.rowIndex === 'number') {
    insertData.row_index = options.rowIndex;
  }

  const { data: assetData, error: assetError } = await supabase
    .from('library_assets')
    .insert(insertData)
    .select('id')
    .single();

  if (assetError) {
    throw assetError;
  }

  const assetId = assetData.id;

  // Step 2: Insert property values
  if (Object.keys(mergedPropertyValues).length > 0) {
    const valueRows = Object.entries(mergedPropertyValues)
      .filter(
        ([_, value]) =>
          value !== null && value !== undefined && (typeof value === 'boolean' || value !== '')
      )
      .map(([fieldId, value]) => ({
        asset_id: assetId,
        field_id: fieldId,
        value_json: value,
      }));

    if (valueRows.length > 0) {
      const { error: valuesError } = await supabase
        .from('library_asset_values')
        .insert(valueRows);

      if (valuesError) {
        // Rollback: delete the asset if values insertion fails
        await supabase.from('library_assets').delete().eq('id', assetId);
        throw valuesError;
      }
    }
  }

  await touchLibraryUpdatedAt(supabase, libraryId);
  return assetId;
}

/**
 * Shift row_index for all assets in a library starting from fromRowIndex by delta.
 * Used for insert-above/below so that newly inserted rows can take a contiguous range.
 */
export async function shiftRowIndices(
  supabase: SupabaseClient,
  libraryId: string,
  fromRowIndex: number,
  delta: number
): Promise<void> {
  if (!delta) return;

  const { error } = await supabase.rpc('shift_row_indices', {
    library_id: libraryId,
    from_row_index: fromRowIndex,
    delta,
  });

  if (error) {
    throw new Error(`Failed to shift row indices: ${error.message}`);
  }

  await touchLibraryUpdatedAt(supabase, libraryId);
}

/** Normalize displayed assets to consecutive 1-based row indices in one RPC. */
export async function normalizeRowIndices(
  supabase: SupabaseClient,
  libraryId: string,
  displayOrderedRows: Array<{ id: string }>
): Promise<void> {
  if (displayOrderedRows.length === 0) return;

  const { error } = await supabase.rpc('normalize_row_indices', {
    p_library_id: libraryId,
    p_asset_ids: displayOrderedRows.map((row) => row.id),
  });

  if (error) {
    throw new Error(`Failed to normalize row indices: ${error.message}`);
  }
}

// T011: Update an existing asset and its property values
export async function updateAsset(
  supabase: SupabaseClient,
  assetId: string,
  assetName: string,
  propertyValues: Record<string, any>
): Promise<void> {
  // Verify user has permission to update asset (admin or editor)
  await verifyAssetUpdatePermission(supabase, assetId);

  const libraryId = await getLibraryIdByAssetId(supabase, assetId);
  const formulaMeta = await getFormulaFieldMetaByLibraryId(supabase, libraryId);
  const mergedPropertyValues = mergeFormulaValuesPreservingCustom(formulaMeta, propertyValues);

  // Step 1: Update the asset name
  const { error: assetError } = await supabase
    .from('library_assets')
    .update({ name: assetName })
    .eq('id', assetId);

  if (assetError) {
    throw assetError;
  }

  // Step 2: Upsert property values
  if (Object.keys(mergedPropertyValues).length > 0) {
    const valueRows = Object.entries(mergedPropertyValues).map(([fieldId, value]) => ({
      asset_id: assetId,
      field_id: fieldId,
      value_json: value,
    }));

    const { error: valuesError } = await supabase
      .from('library_asset_values')
      .upsert(valueRows, {
        onConflict: 'asset_id,field_id',
      });

    if (valuesError) {
      throw valuesError;
    }

    const sourceChanges = Object.entries(mergedPropertyValues).map(([fieldId, value]) => ({
      assetId,
      fieldId,
      valueJson: value,
    }));
    if (sourceChanges.length > 0) {
      await syncReferencesForSourceChanges(supabase, sourceChanges);
    }
  }

  await touchLibraryUpdatedAt(supabase, libraryId);
}

// T012: Delete an asset and its property values
export async function deleteAsset(
  supabase: SupabaseClient,
  assetId: string
): Promise<void> {
  await verifyAssetDeletionPermission(supabase, assetId);
  const libraryId = await getLibraryIdByAssetId(supabase, assetId);
  const { error } = await supabase
    .from('library_assets')
    .delete()
    .eq('id', assetId);
  if (error) throw error;

  await touchLibraryUpdatedAt(supabase, libraryId);
}

/** Batch delete (Supabase .delete().in()). One permission check, one round-trip. */
export async function deleteAssets(
  supabase: SupabaseClient,
  assetIds: string[]
): Promise<void> {
  if (assetIds.length === 0) return;
  if (assetIds.length === 1) {
    await deleteAsset(supabase, assetIds[0]);
    return;
  }
  await verifyAssetsDeletionPermission(supabase, assetIds);
  // Batch deletes are scoped to assets from the same library.
  const libraryId = await getLibraryIdByAssetId(supabase, assetIds[0]);
  const { error } = await supabase
    .from('library_assets')
    .delete()
    .in('id', assetIds);
  if (error) throw error;

  await touchLibraryUpdatedAt(supabase, libraryId);
}
