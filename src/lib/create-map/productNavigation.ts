import { isCreateMapPath } from './isCreateMapPath';
import { isScriptSystemPath } from '@/lib/script-system/isScriptSystemPath';
import { isKeco101Path } from '@/lib/keco-101/isKeco101Path';

export type ProductNavigationItem = 'studio' | 'simulation' | 'script' | 'createMap' | 'keco101';

export type ProductNavigationState = Record<ProductNavigationItem, boolean>;

type ProductNavigationPreferences = {
  scriptProjectId?: string;
  simulationProjectId?: string;
  studioProjectId?: string;
  studioFileHref?: string | null;
};

function isSimulationPath(pathname: string | null): boolean {
  return (pathname ?? '').startsWith('/simulation-system');
}

export function getProductNavigationState(pathname: string | null): ProductNavigationState {
  const simulation = isSimulationPath(pathname);
  const script = isScriptSystemPath(pathname);
  const createMap = isCreateMapPath(pathname);
  const keco101 = isKeco101Path(pathname);

  return {
    studio: !simulation && !script && !createMap && !keco101,
    simulation,
    script,
    createMap,
    keco101,
  };
}

export function getProductNavigationDestination(
  pathname: string | null,
  item: ProductNavigationItem,
  preferences: ProductNavigationPreferences = {}
): string | null {
  const state = getProductNavigationState(pathname);

  if (state[item]) return null;

  if (item === 'studio') {
    if (preferences.studioProjectId) {
      const projectPrefix = `/${preferences.studioProjectId}/`;
      if (preferences.studioFileHref?.startsWith(projectPrefix)) {
        return preferences.studioFileHref;
      }
      return `/${preferences.studioProjectId}/recent`;
    }
    if (state.script && preferences.scriptProjectId) {
      return `/${preferences.scriptProjectId}/recent`;
    }
    if (state.simulation && preferences.simulationProjectId) {
      return `/${preferences.simulationProjectId}/recent`;
    }
    return '/projects';
  }

  if (item === 'simulation') return '/simulation-system';
  if (item === 'script') {
    return preferences.scriptProjectId ? `/script-system/${preferences.scriptProjectId}` : '/script-system';
  }
  if (item === 'keco101') return '/keco-101';
  return '/create-map';
}
