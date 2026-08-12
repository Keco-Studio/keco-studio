import type { UniqueIdentifier } from '@dnd-kit/core';

export function resolveDialogueReorder(
  blockIds: string[],
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier | null,
): { fromIndex: number; toIndex: number } | null {
  if (overId == null || activeId === overId) return null;
  const fromIndex = blockIds.indexOf(String(activeId));
  const toIndex = blockIds.indexOf(String(overId));
  if (fromIndex < 0 || toIndex < 0) return null;
  return { fromIndex, toIndex };
}
