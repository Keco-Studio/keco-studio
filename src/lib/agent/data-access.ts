/**
 * Agent-specific access wrappers around the shared isomorphic services.
 * Keep direct database queries in services so API routes and client code share
 * the same data mapping and authorization behavior.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyLibraryAccess } from '@/lib/services/authorizationService';
import {
  createFolder,
  getFolder,
  listFolderReferences,
} from '@/lib/services/folderService';
import {
  createLibrary,
  deleteLibrary,
  listLibraryReferences,
  renameLibrary,
  type LibraryReference,
} from '@/lib/services/libraryService';
import {
  getLibraryAssetsWithProperties,
  getLibrarySchema,
} from '@/lib/services/libraryAssetsService';
import { sortAssetsForUiRow } from '@/lib/utils/assetEmptiness';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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

type FolderRef = { id: string; name: string };

function nameMatches(expected: string, candidate: string): boolean {
  return candidate === expected || candidate.trim().toLowerCase() === expected.trim().toLowerCase();
}

function pickLibraryFromMatches(
  matches: LibraryReference[],
  options?: LibraryResolveOptions
): ResolvedLibrary | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return { id: matches[0].id, name: matches[0].name };

  if (options?.preferredLibraryId) {
    const preferred = matches.find((match) => match.id === options.preferredLibraryId);
    if (preferred) return { id: preferred.id, name: preferred.name };
  }

  if (options?.preferredFolderId) {
    const inFolder = matches.filter((match) => match.folder_id === options.preferredFolderId);
    if (inFolder.length === 1) return { id: inFolder[0].id, name: inFolder[0].name };
  }

  return null;
}

export async function listProjectLibraries(
  supabase: SupabaseClient,
  projectId: string
): Promise<Array<{ id: string; name: string }>> {
  const rows = await listLibraryReferences(supabase, projectId);
  return rows.map(({ id, name }) => ({ id, name }));
}

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
  const rows = await listLibraryReferences(supabase, projectId);
  const available = rows.map((library) => library.name);

  if (isUuid(libraryName)) {
    await verifyLibraryAccess(supabase, libraryName);
    const match = rows.find((library) => library.id === libraryName);
    return {
      library: match ? { id: match.id, name: match.name } : null,
      available,
    };
  }

  const matches = rows.filter((library) => nameMatches(libraryName, library.name));
  const picked = pickLibraryFromMatches(matches, options);
  if (picked) return { library: picked, available };

  if (matches.length > 1) {
    return {
      library: null,
      available,
      ambiguousMatches: matches.map(({ id, name }) => ({ id, name })),
    };
  }

  return { library: null, available };
}

export async function getLibraryProperties(
  supabase: SupabaseClient,
  libraryId: string
): Promise<PropertyConfig[]> {
  const { properties } = await getLibrarySchema(supabase, libraryId);
  return properties;
}

export async function getLibraryAssets(
  supabase: SupabaseClient,
  libraryId: string
): Promise<AssetRow[]> {
  return getLibraryAssetsWithProperties(supabase, libraryId);
}

export async function getFolderRow(
  supabase: SupabaseClient,
  folderId: string
): Promise<{ id: string; project_id: string; name: string } | null> {
  const folder = await getFolder(supabase, folderId);
  if (!folder) return null;
  return { id: folder.id, project_id: folder.project_id, name: folder.name };
}

export function buildFieldLabelMap(properties: PropertyConfig[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const property of properties) map[property.key] = property.name;
  return map;
}

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

export async function listProjectFolders(
  supabase: SupabaseClient,
  projectId: string
): Promise<FolderRef[]> {
  const rows = await listFolderReferences(supabase, projectId);
  return rows.map(({ id, name }) => ({ id, name }));
}

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

export async function createLibraryServer(
  supabase: SupabaseClient,
  projectId: string,
  name: string,
  folderId?: string,
  description?: string
): Promise<string> {
  return createLibrary(supabase, { projectId, name, folderId, description });
}

export async function createFolderServer(
  supabase: SupabaseClient,
  projectId: string,
  name: string,
  description?: string
): Promise<string> {
  return createFolder(supabase, { projectId, name, description });
}

export async function deleteLibraryServer(
  supabase: SupabaseClient,
  libraryId: string
): Promise<void> {
  return deleteLibrary(supabase, libraryId);
}

export async function renameLibraryServer(
  supabase: SupabaseClient,
  libraryId: string,
  newName: string
): Promise<void> {
  return renameLibrary(supabase, libraryId, newName);
}

export async function resolveAssetByRowIndex(
  supabase: SupabaseClient,
  libraryId: string,
  uiRowNumber: number
): Promise<{ id: string; name: string } | null> {
  const assets = sortAssetsForUiRow(await getLibraryAssets(supabase, libraryId));
  if (uiRowNumber < 1 || uiRowNumber > assets.length) return null;
  const asset = assets[uiRowNumber - 1];
  return { id: asset.id, name: asset.name };
}
