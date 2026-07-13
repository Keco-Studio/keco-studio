import type { SupabaseClient } from '@supabase/supabase-js';
import type { CellsBatchUpdateEvent } from '@/lib/types/collaboration';

export const LIBRARY_RECONCILE_EVENT = 'keco:library-data-reconcile';

export type CellReplacementUpdate = {
  libraryId: string;
  assetId: string;
  propertyKey: string;
  newValue: unknown;
  oldValue?: unknown;
  updatedAt?: string | null;
};

export function groupCellReplacementUpdates(
  cells: CellReplacementUpdate[]
): Map<string, CellReplacementUpdate[]> {
  const grouped = new Map<string, CellReplacementUpdate[]>();
  for (const cell of cells) {
    if (!cell.libraryId) continue;
    const group = grouped.get(cell.libraryId) ?? [];
    group.push(cell);
    grouped.set(cell.libraryId, group);
  }
  return grouped;
}

export function requestLibraryReconciliation(libraryIds: Iterable<string>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LIBRARY_RECONCILE_EVENT, {
    detail: { libraryIds: [...new Set(libraryIds)] },
  }));
}

export async function broadcastCellReplacementBatches(options: {
  supabase: SupabaseClient;
  cells: CellReplacementUpdate[];
  accessToken?: string;
}): Promise<void> {
  const grouped = groupCellReplacementUpdates(options.cells);
  if (grouped.size === 0) return;

  if (options.accessToken) {
    await options.supabase.realtime.setAuth(options.accessToken);
  }

  await Promise.all(Array.from(grouped, async ([libraryId, cells]) => {
    const channel = options.supabase.channel(`library:${libraryId}:edits`);
    try {
      const event: CellsBatchUpdateEvent = {
        type: 'cells:batch-update',
        userId: `cell-replace:${crypto.randomUUID()}`,
        userName: 'Cell replacement',
        timestamp: Date.now(),
        cells: cells.map(({ assetId, propertyKey, newValue, oldValue, updatedAt }) => ({
          assetId,
          propertyKey,
          newValue,
          oldValue,
          updatedAt,
        })),
      };
      const result = await channel.httpSend('cells:batch-update', event);
      if (result.success === false) {
        throw new Error(`Realtime broadcast failed: ${result.error}`);
      }
    } finally {
      await options.supabase.removeChannel(channel);
    }
  }));
}
