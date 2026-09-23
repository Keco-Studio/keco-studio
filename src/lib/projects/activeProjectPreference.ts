export type ActiveProjectPreference = {
  projectId: string;
  projectName: string;
};

const STORAGE_KEY = 'keco.active-project-preference';
export const ACTIVE_PROJECT_EVENT = 'keco-active-project-changed';

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readActiveProjectPreference(): ActiveProjectPreference | null {
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as Partial<ActiveProjectPreference> | null;
    if (!parsed?.projectId || !parsed.projectName) return null;
    return { projectId: parsed.projectId, projectName: parsed.projectName };
  } catch {
    return null;
  }
}

export function writeActiveProjectPreference(preference: ActiveProjectPreference): void {
  const storage = getLocalStorage();
  if (!storage || !preference.projectId || !preference.projectName) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preference));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ACTIVE_PROJECT_EVENT, { detail: preference }));
    }
  } catch {
    /* persistence is best effort */
  }
}
