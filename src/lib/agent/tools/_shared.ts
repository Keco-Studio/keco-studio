/**
 * Re-exports server-safe data access helpers for tool handlers.
 * @see ../data-access.ts
 */

import {
  findLibraryByName,
  getLibraryProperties,
  buildFieldLabelMap,
  type ResolvedLibrary,
  type LibraryResolveOptions,
} from '../data-access';
import type { ToolContext } from '../types';

export {
  findLibraryByName,
  getLibraryProperties,
  buildFieldLabelMap,
  type ResolvedLibrary,
  type LibraryResolveOptions,
};

export function libraryResolveOptionsFromContext(ctx: {
  currentLibraryId?: string;
  currentFolderId?: string;
}): import('../data-access').LibraryResolveOptions {
  return {
    preferredLibraryId: ctx.currentLibraryId,
    preferredFolderId: ctx.currentFolderId,
  };
}

export function formatAmbiguousLibraryError(
  libraryName: string,
  matches: Array<{ id: string; name: string }>
): string {
  const ids = matches.map((m) => m.id).join(', ');
  return `Multiple libraries named "${libraryName}" exist in this project. Open the target library in the UI or pass its UUID. Matching ids: ${ids}`;
}

export type LibraryLookupResult =
  | { ok: true; library: ResolvedLibrary }
  | { ok: false; error: string };

export type OkOrError = { ok: true } | { ok: false; error: string };

/** Extract error message when strict discriminated-union narrowing is disabled. */
export function errorFromLookupResult(result: LibraryLookupResult): string | undefined {
  return 'error' in result ? result.error : undefined;
}

export function libraryFromLookupResult(result: LibraryLookupResult): ResolvedLibrary {
  return (result as Extract<LibraryLookupResult, { ok: true }>).library;
}

export function errorFromOkResult(result: OkOrError): string | undefined {
  return 'error' in result ? result.error : undefined;
}

export async function resolveLibraryForTool(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  projectId: string,
  libraryName: string,
  ctx: Pick<ToolContext, 'userId' | 'accessCache' | 'currentLibraryId' | 'currentFolderId'>
): Promise<LibraryLookupResult> {
  const { library, available, ambiguousMatches } = await findLibraryByName(
    supabase,
    projectId,
    libraryName,
    libraryResolveOptionsFromContext(ctx),
    ctx
  );
  if (ambiguousMatches && ambiguousMatches.length > 1) {
    return { ok: false, error: formatAmbiguousLibraryError(libraryName, ambiguousMatches) };
  }
  if (!library) {
    return {
      ok: false,
      error: `Library "${libraryName}" not found. Available libraries: ${available.join(', ') || '(none)'}`,
    };
  }
  return { ok: true, library };
}
