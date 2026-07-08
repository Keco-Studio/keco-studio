/**
 * Server-safe data access for agent tools.
 *
 * Several existing services are client modules. API routes must not import them,
 * so this module re-implements the small subset of queries the agent needs via
 * direct Supabase calls and authorizationService.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  verifyLibraryAccess,
  verifyProjectAccess,
  verifyFolderAccess,
  verifyLibraryCreationPermission,
  verifyFolderCreationPermission,
  verifyLibraryDeletionPermission,
  verifyLibraryUpdatePermission,
} from '@/lib/services/authorizationService';
import { sortAssetsForUiRow } from '@/lib/utils/assetEmptiness';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

export interface ResolvedLibrary {
  id: string;
  name: string;
}

export type LibraryResolveOptions = {
  /** When multiple libraries share the same name, prefer this id (e.g. active page library). */
  preferredLibraryId?: string;
  /** When multiple libraries share the same name, prefer the one in this folder. */
  preferredFolderId?: string;
};

const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllPaged<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return rows;
}

type FieldDefinitionRow = {
  id: string;
  library_id: string;
  section: string;
  label: string;
  description: string | null;
  data_type: string;
  enum_options: string[] | null;
  reference_libraries: string[] | null;
  formula_expression: string | null;
  order_index: number;
  required?: boolean;
};

function normalizeValue(input: unknown): unknown {
  if (input === null || input === undefined) return null;
  let value = input;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        value = parsed;
      }
    } catch {
      // keep as plain string
    }
  }
  return value;
}

function mapDataTypeToValueType(dataType: string): PropertyConfig['valueType'] {
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
    default:
      return 'other';
  }
}

/** List all libraries in a project (no client-side cache). */
export async function listProjectLibraries(
  supabase: SupabaseClient,
  projectId: string
): Promise<Array<{ id: string; name: string }>> {
  await verifyProjectAccess(supabase, projectId);
  const { data, error } = await supabase
    .from('libraries')
    .select('id, name')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
}

type LibraryRow = { id: string; name: string; folder_id: string | null };

function nameMatches(libraryName: string, candidate: string): boolean {
  return candidate === libraryName || candidate.trim().toLowerCase() === libraryName.trim().toLowerCase();
}

function pickLibraryFromMatches(
  matches: LibraryRow[],
  options?: LibraryResolveOptions
): ResolvedLibrary | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) {
    return { id: matches[0].id, name: matches[0].name };
  }

  if (options?.preferredLibraryId) {
    const preferred = matches.find((m) => m.id === options.preferredLibraryId);
    if (preferred) return { id: preferred.id, name: preferred.name };
  }

  if (options?.preferredFolderId) {
    const inFolder = matches.filter((m) => m.folder_id === options.preferredFolderId);
    if (inFolder.length === 1) {
      return { id: inFolder[0].id, name: inFolder[0].name };
    }
  }

  return null;
}

/**
 * Resolve a library by name (or UUID) within a project.
 * When the same name exists in multiple folders, pass preferredLibraryId or preferredFolderId.
 */
export async function findLibraryByName(
  supabase: SupabaseClient,
  projectId: string,
  libraryName: string,
  options?: LibraryResolveOptions
): Promise<{
  library: ResolvedLibrary | null;
  available: string[];
  ambiguousMatches?: ResolvedLibrary[];
}> {
  const all = await listProjectLibraries(supabase, projectId);
  const available = all.map((l) => l.name);

  if (isUuid(libraryName)) {
    await verifyLibraryAccess(supabase, libraryName);
    const { data, error } = await supabase
      .from('libraries')
      .select('id, name')
      .eq('id', libraryName)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!error && data) {
      return { library: { id: data.id, name: data.name }, available };
    }
    return { library: null, available };
  }

  await verifyProjectAccess(supabase, projectId);
  const { data, error } = await supabase
    .from('libraries')
    .select('id, name, folder_id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as LibraryRow[];
  const matches = rows.filter((row) => nameMatches(libraryName, row.name));
  const picked = pickLibraryFromMatches(matches, options);
  if (picked) {
    return { library: picked, available };
  }

  if (matches.length > 1) {
    return {
      library: null,
      available,
      ambiguousMatches: matches.map((m) => ({ id: m.id, name: m.name })),
    };
  }

  return { library: null, available };
}

/** Load field definitions for a library (server-safe). */
export async function getLibraryProperties(
  supabase: SupabaseClient,
  libraryId: string
): Promise<PropertyConfig[]> {
  await verifyLibraryAccess(supabase, libraryId);

  const { data, error } = await supabase
    .from('library_field_definitions')
    .select('*')
    .eq('library_id', libraryId)
    .order('section', { ascending: true })
    .order('order_index', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as FieldDefinitionRow[];
  const properties: PropertyConfig[] = [];

  for (let row of rows) {
    if (row.data_type === 'media') {
      row = { ...row, data_type: 'image' };
    }
    const sectionId = `${row.library_id}:${row.section}`;
    properties.push({
      id: row.id,
      sectionId,
      key: row.id,
      name: row.label,
      description: row.description,
      valueType: mapDataTypeToValueType(row.data_type),
      dataType: row.data_type as PropertyConfig['dataType'],
      referenceLibraries: row.reference_libraries || undefined,
      enumOptions: row.enum_options || undefined,
      formulaExpression: row.formula_expression || undefined,
      required: row.required ?? false,
      orderIndex: row.order_index,
    });
  }

  properties.sort((a, b) => a.orderIndex - b.orderIndex);
  return properties;
}

/** Load assets with property values for a library (server-safe). */
export async function getLibraryAssets(
  supabase: SupabaseClient,
  libraryId: string
): Promise<AssetRow[]> {
  await verifyLibraryAccess(supabase, libraryId);

  const assets = await fetchAllPaged<{ id: string; library_id: string; name: string; created_at: string; row_index: number | null }>(
    async (from, to) =>
      supabase
        .from('library_assets')
        .select('id, library_id, name, created_at, row_index')
        .eq('library_id', libraryId)
        .order('row_index', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
  );

  if (assets.length === 0) return [];

  const assetIds = assets.map((a) => a.id);
  const valueData = await fetchAllPaged<{ asset_id: string; field_id: string; value_json: unknown }>(
    async (from, to) =>
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
      propertyValues: {},
      created_at: asset.created_at,
      rowIndex: asset.row_index ?? undefined,
    });
  }

  for (const value of valueData) {
    const row = rowsByAssetId.get(value.asset_id);
    if (!row) continue;
    row.propertyValues[value.field_id] = normalizeValue(value.value_json);
  }

  return Array.from(rowsByAssetId.values());
}

/** Load a folder row (server-safe). */
export async function getFolderRow(
  supabase: SupabaseClient,
  folderId: string
): Promise<{ id: string; project_id: string; name: string } | null> {
  if (!isUuid(folderId)) {
    throw new Error('Invalid folder ID format');
  }
  await verifyFolderAccess(supabase, folderId);

  const { data, error } = await supabase
    .from('folders')
    .select('id, project_id, name')
    .eq('id', folderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function buildFieldLabelMap(properties: PropertyConfig[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of properties) {
    map[p.key] = p.name;
  }
  return map;
}

type FolderRef = { id: string; name: string };

/**
 * Pure name/UUID resolver for folders within a project.
 * Strategy: exact match → case-insensitive match → UUID fallback.
 */
export function resolveFolderMatch(rows: FolderRef[], folderName: string): FolderRef | null {
  const exact = rows.find((row) => row.name === folderName);
  if (exact) return { id: exact.id, name: exact.name };

  const insensitive = rows.find((row) => nameMatches(folderName, row.name));
  if (insensitive) return { id: insensitive.id, name: insensitive.name };

  if (isUuid(folderName)) {
    const byId = rows.find((row) => row.id === folderName);
    if (byId) return { id: byId.id, name: byId.name };
  }

  return null;
}

/** List all folders in a project (server-safe, no client cache). */
export async function listProjectFolders(
  supabase: SupabaseClient,
  projectId: string
): Promise<FolderRef[]> {
  await verifyProjectAccess(supabase, projectId);
  const { data, error } = await supabase
    .from('folders')
    .select('id, name')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
}

/**
 * Resolve a folder by name (or UUID) within a project.
 * Mirrors findLibraryByName: exact → case-insensitive → UUID fallback.
 */
export async function findFolderByName(
  supabase: SupabaseClient,
  projectId: string,
  folderName: string
): Promise<{ folder: FolderRef | null; available: string[] }> {
  const rows = await listProjectFolders(supabase, projectId);
  return {
    folder: resolveFolderMatch(rows, folderName),
    available: rows.map((row) => row.name),
  };
}

/** Insert a new library (server-safe). Validates folder ownership when folderId is set. */
export async function createLibraryServer(
  supabase: SupabaseClient,
  projectId: string,
  name: string,
  folderId?: string,
  description?: string
): Promise<string> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Library name is required.');
  }

  await verifyLibraryCreationPermission(supabase, projectId);

  let resolvedFolderId: string | null = null;
  if (folderId) {
    if (!isUuid(folderId)) {
      throw new Error('Invalid folder ID format');
    }
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('project_id')
      .eq('id', folderId)
      .maybeSingle();
    if (folderError) throw folderError;
    if (!folder || folder.project_id !== projectId) {
      throw new Error('Folder not found or does not belong to the project');
    }
    resolvedFolderId = folderId;
  }

  const { data, error } = await supabase
    .from('libraries')
    .insert({
      project_id: projectId,
      folder_id: resolvedFolderId,
      name: trimmedName,
      description: description?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('A library with this name already exists in the project or folder.');
    }
    throw error;
  }

  return data.id as string;
}

/** Insert a new folder (server-safe). */
export async function createFolderServer(
  supabase: SupabaseClient,
  projectId: string,
  name: string,
  description?: string
): Promise<string> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Folder name is required.');
  }

  await verifyFolderCreationPermission(supabase, projectId);

  const { data, error } = await supabase
    .from('folders')
    .insert({
      project_id: projectId,
      name: trimmedName,
      description: description?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('A folder with this name already exists in the project.');
    }
    throw error;
  }

  return data.id as string;
}

/** Delete a library and its cascaded fields/assets/values (server-safe). */
export async function deleteLibraryServer(
  supabase: SupabaseClient,
  libraryId: string
): Promise<void> {
  await verifyLibraryDeletionPermission(supabase, libraryId);
  const { error } = await supabase.from('libraries').delete().eq('id', libraryId);
  if (error) throw error;
}

/** Rename a library (server-safe). */
export async function renameLibraryServer(
  supabase: SupabaseClient,
  libraryId: string,
  newName: string
): Promise<void> {
  const trimmedName = newName.trim();
  if (!trimmedName) {
    throw new Error('Library name is required.');
  }

  await verifyLibraryUpdatePermission(supabase, libraryId);

  const { error } = await supabase
    .from('libraries')
    .update({ name: trimmedName, updated_at: new Date().toISOString() })
    .eq('id', libraryId);

  if (error) {
    if (error.code === '23505') {
      throw new Error('A library with this name already exists in the project or folder.');
    }
    throw error;
  }
}

/** Resolve the asset at a UI table row number (1 = top row), matching query_assets rowIndex. */
export async function resolveAssetByRowIndex(
  supabase: SupabaseClient,
  libraryId: string,
  uiRowNumber: number
): Promise<{ id: string; name: string } | null> {
  const assets = await getLibraryAssets(supabase, libraryId);
  const sorted = sortAssetsForUiRow(assets);
  if (uiRowNumber < 1 || uiRowNumber > sorted.length) {
    return null;
  }
  const asset = sorted[uiRowNumber - 1];
  return { id: asset.id, name: asset.name };
}
