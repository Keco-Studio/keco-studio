import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { SectionConfig, PropertyConfig, AssetRow } from '@/lib/types/libraryAssets';
import type { FormulaEvaluableField } from '@/lib/utils/formula';
import { computeFormulaValuesForRow } from '@/lib/utils/formula';
import * as XLSX from 'xlsx';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

type FieldDefinitionRow = {
  id: string;
  library_id: string;
  section: string;
  label: string;
  description: string | null;
  data_type:
    | 'string'
    | 'string_array'
    | 'int'
    | 'int_array'
    | 'float'
    | 'float_array'
    | 'boolean'
    | 'enum'
    | 'date'
    | 'image'
    | 'file'
    | 'reference'
    | 'multimedia'
    | 'audio'
    | 'formula';
  enum_options: string[] | null;
  reference_libraries: string[] | null;
  formula_expression: string | null;
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

const normalizeValue = (input: unknown): unknown => {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string' && input.trim() !== '') {
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }
  return input;
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

async function verifyLibraryAccessDirect(
  supabase: any,
  userId: string,
  libraryId: string
): Promise<{ name: string }> {
  const { data: library, error: libraryError } = await supabase
    .from('libraries')
    .select('id, name, project_id')
    .eq('id', libraryId)
    .single();

  if (libraryError || !library) {
    throw new Error('Library not found');
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('owner_id')
    .eq('id', library.project_id)
    .single();

  if (projectError || !project) {
    throw new Error('Project not found');
  }

  if (project.owner_id === userId) {
    return { name: library.name };
  }

  const { data: collaborator, error: collabError } = await supabase
    .from('project_collaborators')
    .select('id, accepted_at')
    .eq('project_id', library.project_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (collabError || !collaborator || !collaborator.accepted_at) {
    const authErr = new Error('Unauthorized access to this project');
    (authErr as Error & { name: string }).name = 'AuthorizationError';
    throw authErr;
  }

  return { name: library.name };
}

async function getLibrarySchemaDirect(
  supabase: any,
  libraryId: string
): Promise<{ sections: SectionConfig[]; properties: PropertyConfig[] }> {
  const { data, error } = await supabase
    .from('library_field_definitions')
    .select('*')
    .eq('library_id', libraryId)
    .order('section', { ascending: true })
    .order('order_index', { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as FieldDefinitionRow[];
  if (rows.length === 0) return { sections: [], properties: [] };

  const sectionsByName = new Map<string, { section: SectionConfig; minOrderIndex: number }>();
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
      key: row.id,
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

  const sectionOrderById = new Map<string, number>();
  sections.forEach((section, index) => sectionOrderById.set(section.id, index));

  properties.sort((a, b) => {
    const sa = sectionOrderById.get(a.sectionId) ?? 0;
    const sb = sectionOrderById.get(b.sectionId) ?? 0;
    if (sa !== sb) return sa - sb;
    return a.orderIndex - b.orderIndex;
  });

  return { sections, properties };
}

async function getLibraryAssetsWithPropertiesDirect(
  supabase: any,
  libraryId: string
): Promise<AssetRow[]> {
  const { data: assetData, error: assetError } = await supabase
    .from('library_assets')
    .select('id, library_id, name, created_at, row_index')
    .eq('library_id', libraryId)
    .order('row_index', { ascending: true })
    .order('id', { ascending: true });

  if (assetError) throw assetError;

  const assets = (assetData ?? []) as AssetRowDb[];
  if (assets.length === 0) return [];

  const assetIds = assets.map((a) => a.id);
  const { data: valueData, error: valueError } = await supabase
    .from('library_asset_values')
    .select('asset_id, field_id, value_json')
    .in('asset_id', assetIds);

  if (valueError) throw valueError;

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

  for (const value of (valueData ?? []) as AssetValueRow[]) {
    const row = rowsByAssetId.get(value.asset_id);
    if (!row) continue;
    row.propertyValues[value.field_id] = normalizeValue(value.value_json) as string | number | boolean | null;
  }

  return Array.from(rowsByAssetId.values());
}

/** Format value for export (arrays, media, reference, formula) */
function formatCellValue(
  value: unknown,
  property: PropertyConfig,
  referenceNameById: Map<string, string>
): string | number | boolean | null {
  if (value === null || value === undefined) return null;

  const normalized = parseJsonString(value);

  if (property.dataType === 'int_array' || property.dataType === 'float_array' || property.dataType === 'string_array') {
    if (Array.isArray(normalized)) {
      return JSON.stringify(normalized);
    }
    return typeof normalized === 'string' ? normalized : JSON.stringify(normalized);
  }

  if (property.dataType === 'reference') {
    const resolveReferenceText = (input: string): string => {
      const trimmed = input.trim();
      if (!trimmed) return trimmed;
      if (isUuid(trimmed)) {
        return referenceNameById.get(trimmed) || trimmed;
      }
      if (trimmed.includes(',')) {
        const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
        if (parts.length > 0 && parts.every((part) => isUuid(part))) {
          return parts.map((part) => referenceNameById.get(part) || part).join(', ');
        }
      }
      return referenceNameById.get(trimmed) || trimmed;
    };

    if (typeof normalized === 'string') {
      return resolveReferenceText(normalized);
    }
    if (Array.isArray(normalized)) {
      return normalized
        .map((item) => {
          if (typeof item === 'string') return resolveReferenceText(item);
          if (item && typeof item === 'object') {
            const ref = item as { id?: unknown; assetId?: unknown; name?: unknown };
            if (typeof ref.name === 'string' && ref.name.trim()) return ref.name;
            if (typeof ref.id === 'string') return referenceNameById.get(ref.id) || ref.id;
            if (typeof ref.assetId === 'string') return referenceNameById.get(ref.assetId) || ref.assetId;
          }
          return String(item);
        })
        .join(', ');
    }
    if (normalized && typeof normalized === 'object') {
      const ref = normalized as { id?: unknown; assetId?: unknown; name?: unknown };
      if (typeof ref.name === 'string' && ref.name.trim()) return ref.name;
      if (typeof ref.id === 'string') return referenceNameById.get(ref.id) || ref.id;
      if (typeof ref.assetId === 'string') return referenceNameById.get(ref.assetId) || ref.assetId;
    }
    return typeof normalized === 'object' ? JSON.stringify(normalized) : String(normalized);
  }

  if (
    property.dataType === 'image' ||
    property.dataType === 'file' ||
    property.dataType === 'multimedia' ||
    property.dataType === 'audio'
  ) {
    if (typeof normalized === 'object' && normalized !== null && !Array.isArray(normalized)) {
      const media = normalized as { fileName?: unknown; url?: unknown; path?: unknown };
      const fileName = typeof media.fileName === 'string' ? media.fileName : '';
      const url = typeof media.url === 'string' ? media.url : '';
      const path = typeof media.path === 'string' ? media.path : '';
      if (fileName && url) return `${fileName} | ${url}`;
      if (fileName && path) return `${fileName} | ${path}`;
      return fileName || url || path || JSON.stringify(normalized);
    }
    return typeof normalized === 'string' ? normalized : JSON.stringify(normalized);
  }

  if (property.dataType === 'formula') {
    if (typeof normalized === 'object' && normalized !== null && !Array.isArray(normalized)) {
      const formulaObj = normalized as { result?: unknown; value?: unknown; formula?: unknown };
      if (formulaObj.result !== undefined && formulaObj.result !== null) {
        return String(formulaObj.result);
      }
      if (formulaObj.value !== undefined && formulaObj.value !== null) {
        return String(formulaObj.value);
      }
      if (formulaObj.formula !== undefined && formulaObj.formula !== null) {
        return String(formulaObj.formula);
      }
      return JSON.stringify(normalized);
    }
    return typeof normalized === 'string' ? normalized : JSON.stringify(normalized);
  }

  if (Array.isArray(normalized)) {
    return normalized.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
  }
  if (typeof normalized === 'object') return JSON.stringify(normalized);
  return normalized as string | number | boolean;
}

/** YYYYMMDDHHmmss */
function timestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}${s}`;
}

/** Sanitize filename: replace invalid chars */
function safeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'export';
}

/** Build Content-Disposition filename with UTF-8 support. */
function buildAttachmentFileName(fileNameWithExt: string): string {
  const fallbackAscii = fileNameWithExt
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'export';
  const encoded = encodeURIComponent(fileNameWithExt);
  return `attachment; filename="${fallbackAscii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const supabase = authHeader
    ? createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : createSupabaseServerClient(request);
  const { data: { user }, error: authError } = authHeader
    ? await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    : await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const libraryId = searchParams.get('libraryId');
  const format = (searchParams.get('format') || 'xlsx').toLowerCase();

  if (!libraryId || !isUuid(libraryId)) {
    return NextResponse.json({ error: 'Invalid libraryId' }, { status: 400 });
  }
  if (format !== 'xlsx' && format !== 'json') {
    return NextResponse.json({ error: 'Format must be xlsx or json' }, { status: 400 });
  }

  let libraryNameFromAccess = 'table';
  try {
    const result = await verifyLibraryAccessDirect(supabase, user.id, libraryId);
    libraryNameFromAccess = result.name || libraryNameFromAccess;
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err.name === 'AuthorizationError') {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('not logged in') || msg.includes('jwt') || msg.includes('session')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error)?.message || 'Library not found' }, { status: 404 });
  }

  const [schema, assets] = await Promise.all([
    getLibrarySchemaDirect(supabase, libraryId),
    getLibraryAssetsWithPropertiesDirect(supabase, libraryId),
  ]);

  const libraryName = libraryNameFromAccess || 'table';
  const exportedAt = timestamp();
  const baseName = `${safeFileName(libraryName)}_${exportedAt}`;
  const sections = schema.sections;
  const properties = schema.properties;

  if (format === 'json') {
    const payload = {
      libraryName,
      exportedAt,
      sections: sections.map((s: SectionConfig) => ({ id: s.id, name: s.name, orderIndex: s.orderIndex })),
      properties: properties.map((p: PropertyConfig) => ({
        id: p.id,
        sectionId: p.sectionId,
        key: p.key,
        name: p.name,
        dataType: p.dataType,
        orderIndex: p.orderIndex,
      })),
      rows: assets.map((row: AssetRow) => ({
        id: row.id,
        name: row.name,
        propertyValues: row.propertyValues,
        created_at: row.created_at,
        rowIndex: row.rowIndex,
      })),
    };
    const json = JSON.stringify(payload, null, 2);
    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': buildAttachmentFileName(`${baseName}.json`),
      },
    });
  }

  // xlsx: one sheet, row0 = section names, row1 = label (datatype), row2+ = data
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const referenceNameById = new Map(assets.map((row) => [row.id, row.name]));

  // Reference fields may point to assets in other libraries.
  // Resolve their names in batch to export readable values instead of raw UUID.
  const referenceProps = properties.filter((p) => p.dataType === 'reference');
  const referenceIds = new Set<string>();
  for (const row of assets) {
    for (const prop of referenceProps) {
      const raw = row.propertyValues[prop.key];
      const normalized = parseJsonString(raw);
      if (typeof normalized === 'string' && isUuid(normalized)) {
        referenceIds.add(normalized);
      } else if (typeof normalized === 'string' && normalized.includes(',')) {
        normalized
          .split(',')
          .map((part) => part.trim())
          .filter((part) => isUuid(part))
          .forEach((id) => referenceIds.add(id));
      } else if (Array.isArray(normalized)) {
        for (const item of normalized) {
          if (typeof item === 'string' && isUuid(item)) referenceIds.add(item);
          if (item && typeof item === 'object') {
            const ref = item as { id?: unknown; assetId?: unknown };
            if (typeof ref.id === 'string' && isUuid(ref.id)) referenceIds.add(ref.id);
            if (typeof ref.assetId === 'string' && isUuid(ref.assetId)) referenceIds.add(ref.assetId);
          }
        }
      } else if (normalized && typeof normalized === 'object') {
        const ref = normalized as { id?: unknown; assetId?: unknown };
        if (typeof ref.id === 'string' && isUuid(ref.id)) referenceIds.add(ref.id);
        if (typeof ref.assetId === 'string' && isUuid(ref.assetId)) referenceIds.add(ref.assetId);
      }
    }
  }

  if (referenceIds.size > 0) {
    const referenceIdList = Array.from(referenceIds);
    const { data: refAssets } = await supabase
      .from('library_assets')
      .select('id, name, library_id')
      .in('id', referenceIdList);

    const refAssetRows = (refAssets ?? []) as Array<{ id: string; name: string; library_id: string }>;
    refAssetRows.forEach((asset) => {
      if (asset?.id && asset?.name) referenceNameById.set(asset.id, asset.name);
    });

    // Match in-app reference display: prefer referenced library first-column value over internal asset name.
    const targetLibraryIds = Array.from(
      new Set(refAssetRows.map((asset) => asset.library_id).filter((v): v is string => typeof v === 'string' && v.length > 0))
    );
    if (targetLibraryIds.length > 0) {
      const { data: fieldRows } = await supabase
        .from('library_field_definitions')
        .select('library_id, id, order_index')
        .in('library_id', targetLibraryIds)
        .order('order_index', { ascending: true });

      const firstFieldByLibraryId = new Map<string, string>();
      ((fieldRows ?? []) as Array<{ library_id: string; id: string; order_index: number }>).forEach((row) => {
        if (!firstFieldByLibraryId.has(row.library_id)) {
          firstFieldByLibraryId.set(row.library_id, row.id);
        }
      });

      const firstFieldIds = Array.from(new Set(firstFieldByLibraryId.values()));
      if (firstFieldIds.length > 0) {
        const { data: firstValues } = await supabase
          .from('library_asset_values')
          .select('asset_id, field_id, value_json')
          .in('asset_id', referenceIdList)
          .in('field_id', firstFieldIds);

        const firstValueByAssetId = new Map<string, unknown>();
        ((firstValues ?? []) as Array<{ asset_id: string; field_id: string; value_json: unknown }>).forEach((row) => {
          if (!firstValueByAssetId.has(row.asset_id)) {
            firstValueByAssetId.set(row.asset_id, row.value_json);
          }
        });

        refAssetRows.forEach((asset) => {
          const expectedFirstFieldId = firstFieldByLibraryId.get(asset.library_id);
          const raw = firstValueByAssetId.get(asset.id);
          if (!expectedFirstFieldId || raw === undefined || raw === null) return;
          const normalized = parseJsonString(raw);
          let display: string | null = null;
          if (typeof normalized === 'string') {
            const trimmed = normalized.trim();
            display = trimmed.length > 0 ? trimmed : null;
          } else if (typeof normalized === 'number' || typeof normalized === 'boolean') {
            display = String(normalized);
          } else if (normalized && typeof normalized === 'object') {
            const obj = normalized as { fileName?: unknown; url?: unknown; path?: unknown };
            const fileName = typeof obj.fileName === 'string' ? obj.fileName : '';
            const url = typeof obj.url === 'string' ? obj.url : '';
            const path = typeof obj.path === 'string' ? obj.path : '';
            display = fileName || url || path || JSON.stringify(normalized);
          }
          if (display) {
            referenceNameById.set(asset.id, display);
          }
        });
      }
    }
  }
  const headersSection: string[] = [];
  const headersLabel: string[] = [];
  for (const p of properties) {
    const section = sectionById.get(p.sectionId);
    headersSection.push(section?.name ?? '');
    headersLabel.push(`${p.name} (${p.dataType ?? p.valueType ?? 'other'})`);
  }

  const dataRows: (string | number | boolean | null)[][] = assets.map((row) => {
    const formulaFields: FormulaEvaluableField[] = properties.map((p) => ({
      id: p.id,
      name: p.name,
      dataType: p.dataType,
      formulaExpression: p.formulaExpression,
    }));
    const computedFormulaValues = computeFormulaValuesForRow(formulaFields, row.propertyValues);

    return properties.map((p) => {
      const raw = row.propertyValues[p.key];
      if (p.dataType === 'formula') {
        if (raw === null || raw === undefined || raw === '') {
          const computed = computedFormulaValues[p.id];
          if (computed !== null && computed !== undefined) {
            return computed as string | number | boolean;
          }
        }
        return formatCellValue(raw, p, referenceNameById);
      }
      return formatCellValue(raw, p, referenceNameById);
    });
  });

  const wsData = [headersSection, headersLabel, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Merge section header cells so each section shows once across its columns.
  const merges: XLSX.Range[] = [];
  if (properties.length > 0) {
    let start = 0;
    let currentSection = headersSection[0];
    for (let i = 1; i <= properties.length; i += 1) {
      const sectionAtI = i < properties.length ? headersSection[i] : '__END__';
      if (sectionAtI !== currentSection) {
        if (currentSection && i - start > 1) {
          merges.push({
            s: { r: 0, c: start },
            e: { r: 0, c: i - 1 },
          });
          for (let j = start + 1; j < i; j += 1) {
            wsData[0][j] = '';
          }
        }
        start = i;
        currentSection = sectionAtI;
      }
    }
  }

  if (merges.length > 0) {
    ws['!merges'] = merges;
  }

  // Auto-fit column width for readability.
  const maxRowsForWidth = Math.min(wsData.length, 102);
  ws['!cols'] = properties.map((_, colIdx) => {
    let maxLen = 10;
    for (let rowIdx = 0; rowIdx < maxRowsForWidth; rowIdx += 1) {
      const cellValue = wsData[rowIdx]?.[colIdx];
      const text = cellValue === null || cellValue === undefined ? '' : String(cellValue);
      if (text.length > maxLen) maxLen = text.length;
    }
    return { wch: Math.min(Math.max(maxLen + 2, 12), 40) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, safeFileName(libraryName).slice(0, 31));

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': buildAttachmentFileName(`${baseName}.xlsx`),
    },
  });
}
