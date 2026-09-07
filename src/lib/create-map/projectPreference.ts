export type CreateMapProjectPreference = { projectId: string; projectName: string };

const STORAGE_KEY = 'keco.create-map.projectPreference';
export const CREATE_MAP_PROJECT_EVENT = 'keco-create-map-project';

export function writeCreateMapProjectPreference(preference: CreateMapProjectPreference) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
    window.dispatchEvent(new CustomEvent(CREATE_MAP_PROJECT_EVENT, { detail: preference }));
  } catch {
    /* persistence is best effort */
  }
}

export function readCreateMapProjectPreference(): CreateMapProjectPreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as CreateMapProjectPreference | null;
    return parsed?.projectId && parsed.projectName ? parsed : null;
  } catch {
    return null;
  }
}
