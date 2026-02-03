import { useEffect, useMemo, useRef } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { useYjsRows } from '@/lib/hooks/useYjsRows';

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
      // When we have insert/paste placeholders, never run major-change (which moves temps to end and causes "new row at end")
      const hasInsertOrPastePlaceholders = yjsRowsArray.some(
        (r: AssetRow) => r.id.startsWith('temp-insert-') || r.id.startsWith('temp-paste-')
      );

      if (isMajorChange && !hasInsertOrPastePlaceholders) {
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

      // 1) Replace temp placeholders FIRST so optimistic row stays in place (never lost or moved to end)
      if (rowsToAdd.length > 0) {
        const currentYjsRows = yRows.toArray();
        const insertTempRows: Array<{ index: number; id: string }> = [];
        currentYjsRows.forEach((row: AssetRow, index: number) => {
          if (row.id.startsWith('temp-insert-') || row.id.startsWith('temp-paste-')) {
            insertTempRows.push({ index, id: row.id });
          }
        });
        insertTempRows.sort((a, b) => a.index - b.index);
        const sortedRowsToAdd = [...rowsToAdd].sort((a, b) => {
          const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
          const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
          return ta - tb;
        });
        const rowsToReplace = sortedRowsToAdd.slice(0, Math.min(insertTempRows.length, sortedRowsToAdd.length));
        for (let i = rowsToReplace.length - 1; i >= 0; i--) {
          const newRow = rowsToReplace[i];
          const tempRow = insertTempRows[i];
          yRows.delete(tempRow.index, 1);
          yRows.insert(tempRow.index, [newRow]);
        }
        const remainingRows = sortedRowsToAdd.slice(insertTempRows.length);
        if (remainingRows.length > 0) yRows.insert(yRows.length, remainingRows);
      }

      // 2) Then delete rows in yRows but not in props
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

      // 3) Then apply content updates
      prevRowsRef.current = rows;
    }
  }, [rows, yRows]);

  const allRowsSource = useMemo(
    () => (yjsRows.length > 0 ? yjsRows : rows),
    [yjsRows, rows]
  );

  return { allRowsSource };
}
