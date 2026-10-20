export type DropEdge = 'before' | 'after';

/** Moves one identity-stable item adjacent to another without changing item data. */
export function moveItemAtEdge<T extends { id: string }>(
  items: readonly T[],
  activeId: string,
  overId: string,
  edge: DropEdge,
): T[] {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return [...items];

  const next = [...items];
  const [active] = next.splice(activeIndex, 1);
  const adjustedOverIndex = activeIndex < overIndex ? overIndex - 1 : overIndex;
  next.splice(adjustedOverIndex + (edge === 'after' ? 1 : 0), 0, active);
  return next;
}

export function orderItemsById<T extends { id: string }>(
  items: readonly T[],
  orderedIds: readonly string[] | null,
): T[] {
  if (!orderedIds) return [...items];
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const ordered = orderedIds.flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item] : [];
  });
  const knownIds = new Set(orderedIds);
  return [...ordered, ...items.filter((item) => !knownIds.has(item.id))];
}
