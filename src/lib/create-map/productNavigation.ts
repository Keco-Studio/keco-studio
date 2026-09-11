import { isCreateMapPath } from './isCreateMapPath';
import { isScriptSystemPath } from '@/lib/script-system/isScriptSystemPath';
import { isKeco101Path } from '@/lib/keco-101/isKeco101Path';
import { parseRouteParams } from '@/lib/utils/routeParams';

export type ProductNavigationItem =
  | 'studio'
  | 'simulation'
  | 'script'
  | 'createMap'
  | 'gameDesignSystem'
  | 'keco101'
  | 'kecoAdmin';

export type ProductNavigationState = Record<ProductNavigationItem, boolean>;

export type ProductNavigationPreferences = {
  /** Project currently open in the active product; kept when switching products. */
  activeProjectId?: string;
  scriptProjectId?: string;
  simulationProjectId?: string;
  studioProjectId?: string;
  studioFileHref?: string | null;
  createMapProjectId?: string;
};

function isSimulationPath(pathname: string | null): boolean {
  return (pathname ?? '').startsWith('/simulation-system');
}

function isGameDesignSystemPath(pathname: string | null): boolean {
  return (pathname ?? '').startsWith('/game-design-systems');
}

function isKecoAdminPath(pathname: string | null): boolean {
  return pathname === '/keco-admin' || (pathname ?? '').startsWith('/keco-admin/');
}

export function getProductNavigationState(pathname: string | null): ProductNavigationState {
  const simulation = isSimulationPath(pathname);
  const script = isScriptSystemPath(pathname);
  const createMap = isCreateMapPath(pathname);
  const gameDesignSystem = isGameDesignSystemPath(pathname);
  const keco101 = isKeco101Path(pathname);
  const kecoAdmin = isKecoAdminPath(pathname);

  return {
    studio:
      !simulation &&
      !script &&
      !createMap &&
      !gameDesignSystem &&
      !keco101 &&
      !kecoAdmin,
    simulation,
    script,
    createMap,
    gameDesignSystem,
    keco101,
    kecoAdmin,
  };
}

/**
 * Resolve the project that should stay selected when switching LeftNav products.
 * Prefers the URL project, then the preference for the product that is currently open.
 */
export function resolveActiveProductProjectId(
  pathname: string | null,
  preferences: ProductNavigationPreferences = {}
): string | undefined {
  const state = getProductNavigationState(pathname);
  const routeProjectId = parseRouteParams(pathname ?? '').projectId ?? undefined;

  if (state.script) {
    return routeProjectId ?? preferences.scriptProjectId;
  }
  if (state.simulation) {
    return preferences.simulationProjectId;
  }
  if (state.createMap) {
    return preferences.createMapProjectId;
  }
  if (state.studio) {
    return routeProjectId ?? preferences.studioProjectId;
  }

  return (
    routeProjectId ??
    preferences.studioProjectId ??
    preferences.scriptProjectId ??
    preferences.simulationProjectId ??
    preferences.createMapProjectId
  );
}

export function getProductNavigationDestination(
  pathname: string | null,
  item: ProductNavigationItem,
  preferences: ProductNavigationPreferences = {}
): string | null {
  const state = getProductNavigationState(pathname);

  if (state[item]) return null;

  const activeProjectId =
    preferences.activeProjectId ??
    resolveActiveProductProjectId(pathname, preferences);

  if (item === 'studio') {
    const projectId = activeProjectId ?? preferences.studioProjectId;
    if (projectId) {
      const projectPrefix = `/${projectId}/`;
      if (preferences.studioFileHref?.startsWith(projectPrefix)) {
        return preferences.studioFileHref;
      }
      return `/${projectId}/recent`;
    }
    return '/projects';
  }

  if (item === 'simulation') return '/simulation-system';
  if (item === 'script') {
    const projectId = activeProjectId ?? preferences.scriptProjectId;
    return projectId ? `/script-system/${projectId}` : '/script-system';
  }
  if (item === 'gameDesignSystem') return '/game-design-systems';
  if (item === 'keco101') return '/keco-101';
  if (item === 'kecoAdmin') return '/keco-admin';
  return '/create-map';
}
