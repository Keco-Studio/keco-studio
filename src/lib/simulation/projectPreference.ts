import {
  readActiveProjectPreference,
  writeActiveProjectPreference,
} from '@/lib/projects/activeProjectPreference';

export type SimulationProjectPreference = { projectId: string; projectName: string };

const STORAGE_KEY = 'keco.simulation.projectPreference';

export function writeSimulationProjectPreference(preference: SimulationProjectPreference) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
    writeActiveProjectPreference(preference);
  } catch { /* persistence is best effort */ }
}

export function readSimulationProjectPreference(): SimulationProjectPreference | null {
  const activeProject = readActiveProjectPreference();
  if (activeProject) return activeProject;
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as SimulationProjectPreference | null;
    return parsed?.projectId && parsed.projectName ? parsed : null;
  } catch { return null; }
}
