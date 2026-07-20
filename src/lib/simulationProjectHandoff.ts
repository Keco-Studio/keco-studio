export type SimulationProjectHandoff = {
  projectId: string;
  projectName: string;
};

const STORAGE_KEY = 'keco.simulation.projectHandoff';

export function writeSimulationProjectHandoff(handoff: SimulationProjectHandoff) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    // ignore storage failures
  }
}

export function readSimulationProjectHandoff(): SimulationProjectHandoff | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SimulationProjectHandoff;
    if (!parsed?.projectId || !parsed?.projectName) return null;
    return parsed;
  } catch {
    return null;
  }
}
