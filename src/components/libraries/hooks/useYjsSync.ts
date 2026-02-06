import { useEffect, useMemo, useRef } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { useYjsRows } from '@/lib/hooks/useYjsRows';

/**
 * Sync rows (allAssets = single source of truth) with yRows (local cache).
 *
 * Design: 顺序以 LibraryDataContext 的 allAssets 为准；yRows 仅作本地缓存。
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

    // New rows without a matching temp (e.g. collaborator received asset:create): full replace so order = rows
    const remainingRows = rowsToAdd.filter((r) => !usedNewRowIds.has(r.id));
    if (remainingRows.length > 0) {
      for (let i = yRows.length - 1; i >= 0; i--) yRows.delete(i, 1);
      yRows.insert(0, rows);
    }
    // 兜底：如果此时 yRows 中依然残留 temp 行，但非 temp 行的集合已经与 rows 完全一致，
    // 则直接整表替换，确保本地视图与 allAssets 完全对齐，避免 Paste/Insert 后操作者看到多余「幽灵行」。
    const afterArray: AssetRow[] = yRows.toArray();
    const tempsLeft = afterArray.some((r) => isTempId(r.id));
    if (tempsLeft) {
      const realAfterIds = afterArray.filter((r) => !r.id.startsWith('temp-')).map((r) => r.id);
      const setAfter = new Set(realAfterIds);
      const setRows2 = new Set(idsRows);
      const realMatches =
        setAfter.size === setRows2.size && Array.from(setAfter).every((id) => setRows2.has(id));
      if (realMatches) {
        for (let i = yRows.length - 1; i >= 0; i--) yRows.delete(i, 1);
        yRows.insert(0, rows);
      }
    }
    prevRowsRef.current = rows;
  }, [rows, yRows]);

  // 最终展示一律以 rows(allAssets) 为准，保证所有协作者视图一致。
  // yRows 仅作为本地缓存/占位的中间状态，不直接驱动渲染，避免本地 temp 行导致「操作者看到多余行」。
  const allRowsSource = useMemo(() => {
    return rows;
  }, [rows]);

  return { allRowsSource };
}
