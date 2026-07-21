import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createAccessVerificationCache,
  getCurrentUserId,
  type AccessVerificationContext,
} from '@/lib/services/authorizationService';
import { getLibraryAssetsWithProperties, getLibrarySchema } from '@/lib/services/libraryAssetsService';
import { listLibraries } from '@/lib/services/libraryService';

import type { StudioLibrarySource } from './importAdapter';
import type { LibraryRole } from './types';

const ROLES: readonly LibraryRole[] = ['characters', 'skills', 'level', 'skillc'];

function cloneAndDeepFreeze<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return;
    Object.freeze(candidate);
    for (const nested of Object.values(candidate)) freeze(nested);
  };
  freeze(clone);
  return clone;
}

export async function loadSimulationProjectSources(
  supabase: SupabaseClient,
  projectId: string,
  libraryIds: Readonly<Record<LibraryRole, string>>,
  access?: AccessVerificationContext,
): Promise<Readonly<Record<LibraryRole, StudioLibrarySource>>> {
  const libraries = await listLibraries(supabase, projectId);
  const librariesById = new Map(libraries.map((library) => [library.id, library]));

  for (const role of ROLES) {
    const selected = librariesById.get(libraryIds[role]);
    if (!selected || selected.project_id !== projectId) {
      throw new Error(`Selected ${role} library does not belong to project ${projectId}.`);
    }
  }

  const effectiveAccess = access ?? {
    userId: await getCurrentUserId(supabase),
    cache: createAccessVerificationCache(),
  };
  const uniqueIds = [...new Set(ROLES.map((role) => libraryIds[role]))];
  const loaded = await Promise.all(uniqueIds.map(async (libraryId) => {
    const [schema, assets] = await Promise.all([
      getLibrarySchema(supabase, libraryId, effectiveAccess),
      getLibraryAssetsWithProperties(supabase, libraryId, effectiveAccess),
    ]);
    const library = librariesById.get(libraryId)!;
    const source = cloneAndDeepFreeze<StudioLibrarySource>({
      libraryId,
      libraryName: library.name,
      properties: schema.properties,
      assets,
    });
    return [libraryId, source] as const;
  }));
  const loadedById = new Map(loaded);

  return Object.freeze(Object.fromEntries(
    ROLES.map((role) => [role, loadedById.get(libraryIds[role])!]),
  )) as Readonly<Record<LibraryRole, StudioLibrarySource>>;
}
