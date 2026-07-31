/**
 * Pure helpers for sidebar nesting (folders / documents) used by tree build + DnD.
 */

export const SIDEBAR_MAX_NEST_DEPTH = 8;

export function wouldCreateIdCycle(
  parentById: Map<string, string | null | undefined>,
  nodeId: string,
  newParentId: string | null
): boolean {
  if (!newParentId) return false;
  if (newParentId === nodeId) return true;
  let walk: string | null | undefined = newParentId;
  const seen = new Set<string>();
  while (walk) {
    if (walk === nodeId) return true;
    if (seen.has(walk)) return true;
    seen.add(walk);
    walk = parentById.get(walk) ?? null;
  }
  return false;
}

export function nestingDepthFromRoot(
  parentById: Map<string, string | null | undefined>,
  nodeId: string
): number {
  let depth = 1;
  let walk: string | null | undefined = parentById.get(nodeId) ?? null;
  const seen = new Set<string>([nodeId]);
  while (walk) {
    if (seen.has(walk)) return Number.POSITIVE_INFINITY;
    seen.add(walk);
    depth += 1;
    walk = parentById.get(walk) ?? null;
  }
  return depth;
}

/** Depth of `nodeId` if its parent became `newParentId` (1 = root). */
export function nestingDepthAfterMove(
  parentById: Map<string, string | null | undefined>,
  nodeId: string,
  newParentId: string | null
): number {
  if (!newParentId) return 1;
  return 1 + nestingDepthFromRoot(parentById, newParentId);
}

export function groupIdsByParentKey<T extends { id: string }>(
  items: T[],
  getParentId: (item: T) => string | null | undefined
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const parentKey = getParentId(item) ? String(getParentId(item)) : '';
    if (!map.has(parentKey)) map.set(parentKey, []);
    map.get(parentKey)!.push(item);
  }
  return map;
}
