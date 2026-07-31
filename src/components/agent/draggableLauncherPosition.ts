export const AGENT_LAUNCHER_STORAGE_KEY = 'keco.agentLauncherPosition';
export const AGENT_LAUNCHER_SIZE = 56;
export const AGENT_LAUNCHER_DRAG_THRESHOLD_PX = 5;

export type LauncherPosition = {
  left: number;
  top: number;
};

export function clampLauncherPosition(
  left: number,
  top: number,
  viewportWidth: number,
  viewportHeight: number,
  size: number = AGENT_LAUNCHER_SIZE,
): LauncherPosition {
  const maxLeft = Math.max(0, viewportWidth - size);
  const maxTop = Math.max(0, viewportHeight - size);
  return {
    left: Math.min(maxLeft, Math.max(0, left)),
    top: Math.min(maxTop, Math.max(0, top)),
  };
}

export function readStoredLauncherPosition(
  storage: Pick<Storage, 'getItem'> | null | undefined = typeof window !== 'undefined' ? window.localStorage : null,
): LauncherPosition | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(AGENT_LAUNCHER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LauncherPosition>;
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

export function writeStoredLauncherPosition(
  position: LauncherPosition,
  storage: Pick<Storage, 'setItem'> | null | undefined = typeof window !== 'undefined' ? window.localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(AGENT_LAUNCHER_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Ignore quota / private-mode failures.
  }
}
