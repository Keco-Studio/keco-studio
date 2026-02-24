/**
 * Route params parser: derives currentIds and page type from pathname.
 * Used by NavigationContext; Sidebar/TopBar consume context only, no URL parsing.
 */

export const SPECIAL_ROUTE_SEGMENTS = [
  'folder',
  'collaborators',
  'settings',
  'members',
  'projects',
] as const;

export type RouteParamsResult = {
  projectId: string | null;
  libraryId: string | null;
  folderId: string | null;
  assetId: string | null;
  isPredefinePage: boolean;
  isLibraryPage: boolean;
};

export function parseRouteParams(
  pathname: string,
  _params?: Record<string, string | string[] | undefined>
): RouteParamsResult {
  const parts = pathname.split('/').filter(Boolean);
  const projectId = parts[0] && parts[0] !== 'projects' ? parts[0] : null;
  let libraryId: string | null = null;
  let folderId: string | null = null;
  let isPredefinePage = false;
  let assetId: string | null = null;
  let isLibraryPage = false;

  if (parts.length >= 2 && parts[1] === 'folder' && parts[2]) {
    folderId = parts[2];
  } else if (
    parts.length >= 2 &&
    SPECIAL_ROUTE_SEGMENTS.includes(parts[1] as (typeof SPECIAL_ROUTE_SEGMENTS)[number])
  ) {
    libraryId = null;
  } else if (parts.length >= 3 && parts[2] === 'predefine') {
    libraryId = parts[1];
    isPredefinePage = true;
  } else if (parts.length >= 3) {
    libraryId = parts[1];
    assetId = parts[2];
  } else if (parts.length >= 2) {
    libraryId = parts[1];
    isLibraryPage = true;
  }

  return {
    projectId,
    libraryId,
    folderId,
    assetId,
    isPredefinePage,
    isLibraryPage,
  };
}
