import { SupabaseClient } from '@supabase/supabase-js';
import {
  AssetRow,
  LibrarySummary,
  PropertyConfig,
  SectionConfig,
} from '@/lib/types/libraryAssets';
import { getLibrary } from '@/lib/services/libraryService';
import {
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
 * 统一字段反序列化逻辑，和 LibraryDataContext.loadInitialData 保持一致：
 * - Supabase jsonb 通常已经是对象/原始类型，直接返回
 * - 如果是非空字符串，再尝试 JSON.parse，一旦失败就保留原字符串
 */
const normalizeValue = (input: unknown): any => {
  if (input === null || input === undefined) return null;
  let value = input;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      value = JSON.parse(value);
    } catch {
      // 不是 JSON 字符串，就按普通字符串使用
    }
  }
  return value;
};

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
  libraryId: string
): Promise<{
  sections: SectionConfig[];
  properties: PropertyConfig[];
}> {
  // verify library access
  await verifyLibraryAccess(supabase, libraryId);
  
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

/** 更新 section 显示名称：sectionId 格式为 libraryId:旧名称，将 library_field_definitions 中该 section 的 section 字段改为 newName */
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
}

/** 新增一个 section（在 library_field_definitions 中插入一个默认字段以创建新区块，参考 predefine 的 handleSaveNewSection）。 */
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

  // 与表初始化保持一致：默认创建一个 ID(String) 字段
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

  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`field-definitions:${libraryId}`);
  return { sectionId, sectionName, fieldId: inserted.id as string };
}

/** 在指定 section 下新增一个字段（用于表格内「新增列」弹窗）。sectionId 为前端格式（libraryId:sectionName），内部会按 library_id + section 解析出 DB 的 section_id。 */
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
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`field-definitions:${libraryId}`);
  return { id: inserted.id };
}

/** 删除单个字段（列），会依赖数据库外键自动级联删除该列下所有资产值 */
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

  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`field-definitions:${libraryId}`);
}

/** 更新单个字段（列）的基础信息和类型配置 */
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

  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`field-definitions:${libraryId}`);
}

// T009: Load assets and property values for a library and aggregate into AssetRow[].
export async function getLibraryAssetsWithProperties(
  supabase: SupabaseClient,
  libraryId: string
): Promise<AssetRow[]> {
  // verify library access
  await verifyLibraryAccess(supabase, libraryId);
  
  const { data: assetData, error: assetError } = await supabase
    .from('library_assets')
    .select('id, library_id, name, created_at, row_index')
    .eq('library_id', libraryId)
    // IMPORTANT: 排序逻辑必须与前端 allAssets 完全一致：
    // 先按 row_index，再按 id，避免不同客户端行顺序不一致。
    .order('row_index', { ascending: true })
    .order('id', { ascending: true });

  if (assetError) {
    throw assetError;
  }

  const assets = (assetData ?? []) as AssetRowDb[];

  if (assets.length === 0) {
    return [];
  }

  const assetIds = assets.map((a) => a.id);

  const { data: valueData, error: valueError } = await supabase
    .from('library_asset_values')
    .select('asset_id, field_id, value_json')
    .in('asset_id', assetIds);

  if (valueError) {
    throw valueError;
  }

  const values = (valueData ?? []) as AssetValueRow[];

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
  if (Object.keys(propertyValues).length > 0) {
    const valueRows = Object.entries(propertyValues)
      .filter(([_, value]) => value !== null && value !== undefined && value !== '')
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

  const { data, error } = await supabase
    .from('library_assets')
    .select('id, row_index')
    .eq('library_id', libraryId)
    .gte('row_index', fromRowIndex)
    .order('row_index', { ascending: delta > 0 });

  if (error) {
    throw new Error(`Failed to load rows for shifting indices: ${error.message}`);
  }

  const rows = (data || []) as { id: string; row_index: number | null }[];
  if (rows.length === 0) return;

  const ordered = delta > 0 ? rows.reverse() : rows;

  for (const row of ordered) {
    if (row.row_index == null) continue;
    const newIndex = row.row_index + delta;
    const { error: updateError } = await supabase
      .from('library_assets')
      .update({ row_index: newIndex })
      .eq('id', row.id);
    if (updateError) {
      throw new Error(`Failed to shift row_index for asset ${row.id}: ${updateError.message}`);
    }
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
  
  // Step 1: Update the asset name
  const { error: assetError } = await supabase
    .from('library_assets')
    .update({ name: assetName })
    .eq('id', assetId);

  if (assetError) {
    throw assetError;
  }

  // Step 2: Upsert property values
  if (Object.keys(propertyValues).length > 0) {
    const valueRows = Object.entries(propertyValues).map(([fieldId, value]) => ({
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
  }
}

// T012: Delete an asset and its property values
export async function deleteAsset(
  supabase: SupabaseClient,
  assetId: string
): Promise<void> {
  await verifyAssetDeletionPermission(supabase, assetId);
  const { error } = await supabase
    .from('library_assets')
    .delete()
    .eq('id', assetId);
  if (error) throw error;
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
  const { error } = await supabase
    .from('library_assets')
    .delete()
    .in('id', assetIds);
  if (error) throw error;
}

