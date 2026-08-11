/**
 * Route params parser: derives currentIds and page type from pathname.
 * Used by NavigationContext; Sidebar/TopBar consume context only, no URL parsing.
 */

import { isUuid } from '@/lib/utils/uuid';

export const SPECIAL_ROUTE_SEGMENTS = [
  'folder',
  'doc',
  'collaborators',
  'admin',
  'recent',
  'settings',
  'members',
  'projects',
  'battle-simulator',
  'economy-simulator',
  'simulation-system',
  'script-system',
  'design-upload',
  'mcp',
] as const;

export type RouteParamsResult = {
  projectId: string | null;
  libraryId: string | null;
  folderId: string | null;
  assetId: string | null;
  documentId: string | null;
  isPredefinePage: boolean;
  isLibraryPage: boolean;
};

export function parseRouteParams(
  pathname: string,
  _params?: Record<string, string | string[] | undefined>
): RouteParamsResult {
  const parts = pathname.split('/').filter(Boolean);

  // Root-level special pages have no project context.
  if (parts.length === 1 && SPECIAL_ROUTE_SEGMENTS.includes(parts[0] as (typeof SPECIAL_ROUTE_SEGMENTS)[number])) {
    return {
      projectId: null,
      libraryId: null,
      folderId: null,
      assetId: null,
      documentId: null,
      isPredefinePage: false,
      isLibraryPage: false,
    };
  }

  // simulation-system routes are special pages without project authorization.
  if (parts[0] === 'simulation-system') {
    // economy subroutes
    if (parts[1] === 'economy') {
      const subPage = parts[2];
      // Direct child pages, such as overview.
      if (!subPage || subPage === 'overview') {
        return {
          projectId: null,
          libraryId: null,
          folderId: null,
          assetId: null,
          documentId: null,
          isPredefinePage: true,
          isLibraryPage: false,
        };
      }
      // Nested module pages.
      return {
        projectId: null,
        libraryId: null,
        folderId: null,
        assetId: null,
        documentId: null,
        isPredefinePage: true,
        isLibraryPage: false,
      };
    }
    // battle subroutes
    if (parts[1] === 'battle') {
      return {
        projectId: null,
        libraryId: null,
        folderId: null,
        assetId: null,
        documentId: null,
        isPredefinePage: true,
        isLibraryPage: false,
      };
    }
    // simulation-system root
    return {
      projectId: null,
      libraryId: null,
      folderId: null,
      assetId: null,
      documentId: null,
      isPredefinePage: true,
      isLibraryPage: false,
    };
  }

  // script-system routes carry project context but are not Studio project routes.
  if (parts[0] === 'script-system') {
    let projectId: string | null = null;
    let libraryId: string | null = null;
    let documentId: string | null = null;

    if (isUuid(parts[1])) {
      projectId = parts[1];
      if (parts[2] === 'doc' && parts[3]) {
        documentId = parts[3];
      } else if (parts[2] === 'script' && parts[3]) {
        libraryId = parts[3];
      }
    }

    return {
      projectId,
      libraryId,
      folderId: null,
      assetId: null,
      documentId,
      isPredefinePage: false,
      isLibraryPage: false,
    };
  }

  const projectId = parts[0] && parts[0] !== 'projects' ? parts[0] : null;
  let libraryId: string | null = null;
  let folderId: string | null = null;
  let documentId: string | null = null;
  let isPredefinePage = false;
  let assetId: string | null = null;
  let isLibraryPage = false;

  if (parts.length >= 2 && parts[1] === 'folder' && parts[2]) {
    folderId = parts[2];
  } else if (parts.length >= 3 && parts[1] === 'doc') {
    // /[projectId]/doc/[documentId] — a document page, not a library.
    documentId = parts[2];
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
    documentId,
    isPredefinePage,
    isLibraryPage,
  };
}
