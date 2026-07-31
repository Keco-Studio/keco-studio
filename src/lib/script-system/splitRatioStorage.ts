export const SPLIT_RATIO_KEY = 'keco.script.splitRatio';
export const DEFAULT_SPLIT_RATIO = 0.68;
export const MIN_SPLIT_RATIO = 0.35;
export const MAX_SPLIT_RATIO = 0.8;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function readSplitRatio(): number {
  if (typeof window === 'undefined') return DEFAULT_SPLIT_RATIO;
  try {
    const raw = window.localStorage.getItem(SPLIT_RATIO_KEY);
    if (raw == null || raw === '') return DEFAULT_SPLIT_RATIO;
    return clampSplitRatio(Number(raw));
  } catch {
    return DEFAULT_SPLIT_RATIO;
  }
}

export function writeSplitRatio(ratio: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      SPLIT_RATIO_KEY,
      String(clampSplitRatio(ratio))
    );
  } catch {
    // Persistence is best-effort (private mode / quota).
  }
}
