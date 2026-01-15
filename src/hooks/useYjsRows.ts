/**
 * React Hook for Yjs Rows
 * 
 * Subscribes to Y.Array changes and automatically updates React state
 */

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { AssetRow } from '@/lib/types/libraryAssets';

/**
 * Subscribes to Y.Array changes and returns a snapshot of the current array
 * 
 * @param yRows Yjs Array instance
 * @returns A snapshot of the current array (automatically updates)
 */
export function useYjsRows(yRows: Y.Array<AssetRow>): AssetRow[] {
  const [rows, setRows] = useState<AssetRow[]>([]);

  useEffect(() => {
    // Initial read
    setRows(yRows.toArray());

    // Listen for changes
    const updateRows = () => {
      setRows(yRows.toArray());
    };

    // Subscribe to changes
    yRows.observe(updateRows);

    // Cleanup
    return () => {
      yRows.unobserve(updateRows);
    };
  }, [yRows]);

  return rows;
}

