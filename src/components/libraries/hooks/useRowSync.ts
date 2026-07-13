import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';
import type { ObservableRowStore } from '@/lib/library/rowStore';

const isPlaceholder = (id: string) =>
  id.startsWith('temp-insert-') || id.startsWith('temp-paste-');

export function useRowSync(
  rows: AssetRow[],
  rowStore: ObservableRowStore
): { allRowsSource: AssetRow[] } {
  const rowSnapshot = useSyncExternalStore(
    rowStore.subscribe,
    rowStore.getSnapshot,
    rowStore.getSnapshot
  );

  useEffect(() => {
    const storedRows = rowStore.toArray();
    if (storedRows.length === 0) {
      if (rows.length > 0) rowStore.replace(rows);
      return;
    }
    if (rows.length === 0) return;

    const placeholders = storedRows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => isPlaceholder(row.id));
    if (placeholders.length === 0) {
      const changed =
        storedRows.length !== rows.length ||
        storedRows.some((row, index) =>
          JSON.stringify(row) !== JSON.stringify(rows[index])
        );
      if (changed) rowStore.replace(rows);
      return;
    }

    const storedIds = new Set(storedRows.map((row) => row.id));
    const newRows = rows.filter((row) => !storedIds.has(row.id));
    if (newRows.length === 0) return;
    const newRowIds = new Set(newRows.map((row) => row.id));

    rowStore.transact(() => {
      for (const { index } of placeholders.sort((left, right) => right.index - left.index)) {
        const replacement = rows[index];
        if (!replacement || !newRowIds.has(replacement.id)) continue;
        rowStore.delete(index, 1);
        rowStore.insert(index, [replacement]);
        newRowIds.delete(replacement.id);
      }
      const remainingPlaceholders = rowStore.toArray().some((row) => isPlaceholder(row.id));
      if (!remainingPlaceholders && newRowIds.size > 0) rowStore.replace(rows);
    });
  }, [rowStore, rows]);

  const allRowsSource = useMemo(() => {
    const snapshotRows = [...rowSnapshot];
    return snapshotRows.some((row) => isPlaceholder(row.id)) ? snapshotRows : rows;
  }, [rowSnapshot, rows]);

  return { allRowsSource };
}
