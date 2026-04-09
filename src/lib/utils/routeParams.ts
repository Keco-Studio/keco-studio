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
  'battle-simulator',
  'economy-simulator',
  'simulation-system',
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

  // 根路径特殊页面 (没有项目上下文的路由)
  if (parts.length === 1 && SPECIAL_ROUTE_SEGMENTS.includes(parts[0] as (typeof SPECIAL_ROUTE_SEGMENTS)[number])) {
    return {
      projectId: null,
      libraryId: null,
      folderId: null,
      assetId: null,
      isPredefinePage: false,
      isLibraryPage: false,
    };
  }

  // simulation-system 及其子路由也是特殊页面（不涉及项目授权）- 优化：提前返回
  if (parts[0] === 'simulation-system') {
    // economy 子路由
    if (parts[1] === 'economy') {
      const subPage = parts[2];
      // 直接子页面（概览等）
      if (!subPage || subPage === 'overview') {
        return {
          projectId: null,
          libraryId: null,
          folderId: null,
          assetId: null,
          isPredefinePage: true,
          isLibraryPage: false,
        };
      }
      // 子模块页面
      return {
        projectId: null,
        libraryId: null,
        folderId: null,
        assetId: null,
        isPredefinePage: true,
        isLibraryPage: false,
      };
    }
    // battle 子路由
    if (parts[1] === 'battle') {
      return {
        projectId: null,
        libraryId: null,
        folderId: null,
        assetId: null,
        isPredefinePage: true,
        isLibraryPage: false,
      };
    }
    // simulation-system 自身
    return {
      projectId: null,
      libraryId: null,
      folderId: null,
      assetId: null,
      isPredefinePage: true,
      isLibraryPage: false,
    };
  }

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
