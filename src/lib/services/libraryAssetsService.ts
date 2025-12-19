import { SupabaseClient } from '@supabase/supabase-js';
import {
  AssetRow,
  LibrarySummary,
  PropertyConfig,
  SectionConfig,
} from '@/lib/types/libraryAssets';
import { getLibrary } from '@/lib/services/libraryService';

type FieldDefinitionRow = {
  id: string;
  library_id: string;
  section: string;
  label: string;
  data_type: 'string' | 'int' | 'float' | 'boolean' | 'enum' | 'date' | 'media' | 'reference';
  enum_options: string[] | null;
  required: boolean;
  order_index: number;
};

type AssetRowDb = {
  id: string;
  library_id: string;
  name: string;
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

const normalizeValue = (input: unknown): string | number | boolean | null => {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }
  // Fallback: stringify complex JSON so UI can still display something sensible.
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
};

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

  for (const row of rows) {
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
      valueType: mapDataTypeToValueType(row.data_type),
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

// T009: Load assets and property values for a library and aggregate into AssetRow[].
export async function getLibraryAssetsWithProperties(
  supabase: SupabaseClient,
  libraryId: string
): Promise<AssetRow[]> {
  const { data: assetData, error: assetError } = await supabase
    .from('library_assets')
    .select('id, library_id, name')
    .eq('library_id', libraryId)
    .order('created_at', { ascending: true });

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
    });
  }

  for (const value of values) {
    const row = rowsByAssetId.get(value.asset_id);
    if (!row) continue;
    row.propertyValues[value.field_id] = normalizeValue(value.value_json);
  }

  return Array.from(rowsByAssetId.values());
}

