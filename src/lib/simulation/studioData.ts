import type { SupabaseClient } from '@supabase/supabase-js';

import { getLibraryAssetsWithProperties, getLibrarySchema } from '@/lib/services/libraryAssetsService';
import { listLibraries } from '@/lib/services/libraryService';

import type { StudioLibrarySource } from './importAdapter';
import type { LibraryRole } from './types';

const ROLES: readonly LibraryRole[] = ['characters', 'skills', 'level', 'skillc'];

export async function loadSimulationProjectSources(
  supabase: SupabaseClient,
  projectId: string,
  libraryIds: Readonly<Record<LibraryRole, string>>,
): Promise<Readonly<Record<LibraryRole, StudioLibrarySource>>> {
  const libraries = await listLibraries(supabase, projectId);
  const librariesById = new Map(libraries.map((library) => [library.id, library]));

  for (const role of ROLES) {
    const selected = librariesById.get(libraryIds[role]);
    if (!selected || selected.project_id !== projectId) {
      throw new Error(`Selected ${role} library does not belong to project ${projectId}.`);
    }
  }

  const uniqueIds = [...new Set(ROLES.map((role) => libraryIds[role]))];
  const loaded = await Promise.all(uniqueIds.map(async (libraryId) => {
    const [schema, assets] = await Promise.all([
      getLibrarySchema(supabase, libraryId),
      getLibraryAssetsWithProperties(supabase, libraryId),
    ]);
    const library = librariesById.get(libraryId)!;
    const source: StudioLibrarySource = Object.freeze({
      libraryId,
      libraryName: library.name,
      properties: Object.freeze([...schema.properties]),
      assets: Object.freeze([...assets]),
    });
    return [libraryId, source] as const;
  }));
  const loadedById = new Map(loaded);

  return Object.freeze(Object.fromEntries(
    ROLES.map((role) => [role, loadedById.get(libraryIds[role])!]),
  )) as Readonly<Record<LibraryRole, StudioLibrarySource>>;
}
