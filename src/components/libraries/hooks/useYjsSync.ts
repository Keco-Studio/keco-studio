import { useEffect, useMemo, useRef } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { useYjsRows } from '@/hooks/useYjsRows';

/**
 * useYjsSync - 将 props.rows 与 Yjs yRows 同步，并产出统一数据源 allRowsSource
 *
 * - 首次：Yjs 为空时用 rows 初始化
 * - 增量：根据 props 增删改，保留 temp- 行
 * - 大变更（如切 version）：重叠 <30% 时整表替换，保留 temp- 行
 * - allRowsSource：yjsRows 优先，否则回退到 rows
 */
export function useYjsSync(rows: AssetRow[], yRows: any): { allRowsSource: AssetRow[] } {
  const yjsRows = useYjsRows(yRows);
  const prevRowsRef = useRef<AssetRow[]>([]);

  useEffect(() => {
    if (yRows.length === 0 && rows.length > 0) {
      yRows.insert(0, rows);
      prevRowsRef.current = rows;
    } else if (yRows.length > 0 && rows.length > 0) {
      const yjsRowsArray = yRows.toArray();
      const existingIds = new Set<string>(yjsRowsArray.map((r: AssetRow) => r.id));
      const propsIds = new Set<string>(rows.map(r => r.id));

      const overlapCount = Array.from(existingIds).filter((id: string) => propsIds.has(id)).length;
      const overlapRatio = existingIds.size > 0 ? overlapCount / existingIds.size : 0;
      const isMajorChange = overlapRatio < 0.3 && propsIds.size > 0;

      if (isMajorChange) {
        const tempRowsToKeep: AssetRow[] = [];
        const indicesToKeep: number[] = [];

        yjsRowsArray.forEach((yjsRow: AssetRow, index: number) => {
          if (yjsRow.id.startsWith('temp-')) {
            tempRowsToKeep.push(yjsRow);
            indicesToKeep.push(index);
          }
        });

        const indicesToDelete: number[] = [];
        for (let i = yjsRowsArray.length - 1; i >= 0; i--) {
          if (!indicesToKeep.includes(i)) indicesToDelete.push(i);
        }

        indicesToDelete.forEach(index => {
          try {
            if (index >= 0 && index < yRows.length) yRows.delete(index, 1);
          } catch (e) {
            console.warn('Failed to delete row at index:', index, e);
          }
        });

        if (rows.length > 0) yRows.insert(0, rows);
        if (tempRowsToKeep.length > 0) yRows.insert(yRows.length, tempRowsToKeep);

        prevRowsRef.current = rows;
        return;
      }

      const rowsToUpdate: Array<{ index: number; row: AssetRow }> = [];
      const rowsToAdd: AssetRow[] = [];
      const indicesToDelete: number[] = [];

      yjsRowsArray.forEach((yjsRow: AssetRow, index: number) => {
        if (yjsRow.id.startsWith('temp-')) return;

        const propsRow = rows.find(r => r.id === yjsRow.id);
        if (propsRow) {
          const yjsRowStr = JSON.stringify({ ...yjsRow, propertyValues: yjsRow.propertyValues });
          const propsRowStr = JSON.stringify({ ...propsRow, propertyValues: propsRow.propertyValues });
          if (yjsRowStr !== propsRowStr) rowsToUpdate.push({ index, row: propsRow });
        } else {
          indicesToDelete.push(index);
        }
      });

      rows.forEach(propsRow => {
        if (!existingIds.has(propsRow.id)) rowsToAdd.push(propsRow);
      });

      indicesToDelete.sort((a, b) => b - a).forEach(index => {
        try {
          yRows.delete(index, 1);
        } catch (e) {
          console.warn('Failed to delete row at index:', index, e);
        }
      });

      const currentYjsArray = yRows.toArray();
      rowsToUpdate.sort((a, b) => b.index - a.index).forEach(({ index, row }) => {
        try {
          const currentIndex = currentYjsArray.findIndex((r: AssetRow) => r.id === row.id);
          if (currentIndex >= 0 && currentIndex < yRows.length) {
            yRows.delete(currentIndex, 1);
            yRows.insert(currentIndex, [row]);
            currentYjsArray.splice(currentIndex, 1);
            currentYjsArray.splice(currentIndex, 0, row);
          } else {
            console.warn('Row not found for update:', row.id);
          }
        } catch (e) {
          console.warn('Failed to update row:', row.id, e);
        }
      });

      prevRowsRef.current = rows;

      if (rowsToAdd.length > 0) {
        const currentYjsRows = yRows.toArray();
        const placeholderTempRows: Array<{ index: number; id: string }> = [];
        currentYjsRows.forEach((row: AssetRow, index: number) => {
          if (row.id.startsWith('temp-insert-') || row.id.startsWith('temp-paste-')) {
            placeholderTempRows.push({ index, id: row.id });
          }
        });
        placeholderTempRows.sort((a, b) => a.index - b.index);

        const rowsToReplace = rowsToAdd.slice(0, Math.min(placeholderTempRows.length, rowsToAdd.length));
        for (let i = rowsToReplace.length - 1; i >= 0; i--) {
          const newRow = rowsToReplace[i];
          const tempRow = placeholderTempRows[i];
          yRows.delete(tempRow.index, 1);
          yRows.insert(tempRow.index, [newRow]);
        }

        const remainingRows = rowsToAdd.slice(placeholderTempRows.length);
        if (remainingRows.length > 0) yRows.insert(yRows.length, remainingRows);
      }

      prevRowsRef.current = rows;
    }
  }, [rows, yRows]);

  const allRowsSource = useMemo(
    () => (yjsRows.length > 0 ? yjsRows : rows),
    [yjsRows, rows]
  );

  return { allRowsSource };
}
