import { useEffect, useMemo, useRef } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { useYjsRows } from '@/lib/hooks/useYjsRows';

/**
 * Sync rows (allAssets = single source of truth) with yRows (local cache).
 *
 * Design: ordering follows LibraryDataContext's allAssets as source of truth; yRows is only a local cache.
 * - When there are NO local insert/paste placeholders: display rows directly → same order for all clients.
 * - When there ARE placeholders (local user just did "insert above"): display yjsRows so temp stays in place;
 *   only job is to replace temp at index K with rows[K] when the real row arrives.
 */
export function useYjsSync(rows: AssetRow[], yRows: any): { allRowsSource: AssetRow[] } {
  const yjsRows = useYjsRows(yRows);
  const prevRowsRef = useRef<AssetRow[]>([]);

  useEffect(() => {
    if (yRows.length === 0 && rows.length > 0) {
      yRows.insert(0, rows);
      prevRowsRef.current = rows;
      return;
    }
    if (rows.length === 0) return;

    const yjsRowsArray = yRows.toArray();
    const isTempId = (id: string) => id.startsWith('temp-insert-') || id.startsWith('temp-paste-');
    const hasPlaceholders = yjsRowsArray.some((r: AssetRow) => isTempId(r.id));

    const realIdsY = yjsRowsArray.filter((r: AssetRow) => !r.id.startsWith('temp-')).map((r: AssetRow) => r.id);
    const idsRows = rows.map((r) => r.id);
    const setY = new Set(realIdsY);
    const setR = new Set(idsRows);
    const setMatches = setY.size === setR.size && Array.from(setY).every((id: string) => setR.has(id));
    const orderDiffers = setMatches && realIdsY.join(',') !== idsRows.join(',');
    const countOrSetDiffers = !setMatches;

    // No placeholders: rows is source of truth → full replace so yRows = rows (and display will use rows)
    if (!hasPlaceholders) {
      if (countOrSetDiffers || orderDiffers) {
        for (let i = yRows.length - 1; i >= 0; i--) yRows.delete(i, 1);
        yRows.insert(0, rows);
        prevRowsRef.current = rows;
      } else {
        // Same set and order: only apply content updates (high index first so indices don't shift)
        const rowsToUpdate: Array<{ index: number; row: AssetRow }> = [];
        yjsRowsArray.forEach((yjsRow: AssetRow, index: number) => {
          if (yjsRow.id.startsWith('temp-')) return;
          const propsRow = rows.find((r) => r.id === yjsRow.id);
          if (propsRow) {
            const yStr = JSON.stringify({ ...yjsRow, propertyValues: yjsRow.propertyValues });
            const pStr = JSON.stringify({ ...propsRow, propertyValues: propsRow.propertyValues });
            if (yStr !== pStr) rowsToUpdate.push({ index, row: propsRow });
          }
        });
        const current = yRows.toArray();
        rowsToUpdate.sort((a, b) => b.index - a.index).forEach(({ index, row }) => {
          const idx = current.findIndex((r: AssetRow) => r.id === row.id);
          if (idx >= 0 && idx < yRows.length) {
            yRows.delete(idx, 1);
            yRows.insert(idx, [row]);
            current.splice(idx, 1);
            current.splice(idx, 0, row);
          }
        });
        prevRowsRef.current = rows;
      }
      return;
    }

    // Has placeholders (local "insert above"): replace temp at K with rows[K] when rows[K] is the new row
    const existingIds = new Set(yjsRowsArray.map((r: AssetRow) => r.id));
    const rowsToAdd = rows.filter((r) => !existingIds.has(r.id));
    if (rowsToAdd.length === 0) {
      prevRowsRef.current = rows;
      return;
    }

    const insertTempRows: Array<{ index: number; id: string }> = [];
    yjsRowsArray.forEach((row: AssetRow, index: number) => {
      if (isTempId(row.id)) {
        insertTempRows.push({ index, id: row.id });
      }
    });
    insertTempRows.sort((a, b) => a.index - b.index);
    const rowsToAddIds = new Set(rowsToAdd.map((r) => r.id));
    const usedNewRowIds = new Set<string>();

    for (let i = insertTempRows.length - 1; i >= 0; i--) {
      const { index: K } = insertTempRows[i];
      const rowAtK = rows[K];
      if (rowAtK && rowsToAddIds.has(rowAtK.id)) {
        usedNewRowIds.add(rowAtK.id);
        yRows.delete(K, 1);
        yRows.insert(K, [rowAtK]);
      }
    }

    // After matching temps to real rows, check whether temps remain in yRows.
    //
    // KEY RULE: NEVER do a full replace while ANY temps still exist.
    // A full replace would wipe placeholder rows and cause visible flicker
    // (rows disappear then reappear).  The final loadInitialData() at the end
    // of the insert batch will deliver all real rows; the next run of this
    // effect will then match and replace the remaining temps.  Once all temps
    // are gone, the `allRowsSource` useMemo switches from yjsRows to rows,
    // and any subsequent run of this effect (in the `!hasPlaceholders` branch)
    // can safely do a full replace if needed.
    const afterArray: AssetRow[] = yRows.toArray();
    const tempsLeft = afterArray.some((r) => isTempId(r.id));

    if (!tempsLeft) {
      // All temps were successfully matched — safe to do a full replace if
      // there are unmatched new rows (e.g. from a collaborator's concurrent insert).
      const remainingRows = rowsToAdd.filter((r) => !usedNewRowIds.has(r.id));
      if (remainingRows.length > 0) {
        for (let i = yRows.length - 1; i >= 0; i--) yRows.delete(i, 1);
        yRows.insert(0, rows);
      }
    }
    // else: temps still present → leave yRows completely untouched.
    prevRowsRef.current = rows;
  }, [rows, yRows]);

  // Normally use rows (allAssets) as the display source to keep all collaborators in sync.
  // Exception: when local yRows contains temp-insert-* placeholder rows (user just did Insert Row Above/Below),
  // use yjsRows as the display source so temp rows are immediately visible. Once DB operations complete
  // and real rows replace the temps, this automatically switches back to rows.
  const allRowsSource = useMemo(() => {
    const hasInsertPlaceholders = yjsRows.some((r: AssetRow) =>
      r.id.startsWith('temp-insert-')
    );
    if (hasInsertPlaceholders) {
      return yjsRows;
    }
    return rows;
  }, [rows, yjsRows]);

  return { allRowsSource };
}
