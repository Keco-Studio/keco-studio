export type ScriptProjectPreference = { projectId: string; projectName: string };

const STORAGE_KEY = 'keco.script.projectPreference';

export function writeScriptProjectPreference(preference: ScriptProjectPreference) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference)); } catch { /* persistence is best effort */ }
}

export function readScriptProjectPreference(): ScriptProjectPreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as ScriptProjectPreference | null;
    return parsed?.projectId && parsed.projectName ? parsed : null;
  } catch { return null; }
}
