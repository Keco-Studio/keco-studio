/**
 * React Hook for Yjs Rows
 * 
 * 订阅 Y.Array 的变化，自动更新 React 状态
 */

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { AssetRow } from '@/lib/types/libraryAssets';

/**
 * 订阅 Y.Array 的变化，返回当前数组的快照
 * 
 * @param yRows Yjs Array 实例
 * @returns 当前数组的快照（会自动更新）
 */
export function useYjsRows(yRows: Y.Array<AssetRow>): AssetRow[] {
  const [rows, setRows] = useState<AssetRow[]>([]);

  useEffect(() => {
    // 初始读取
    setRows(yRows.toArray());

    // 监听变化
    const updateRows = () => {
      setRows(yRows.toArray());
    };

    // 订阅变化
    yRows.observe(updateRows);

    // 清理
    return () => {
      yRows.unobserve(updateRows);
    };
  }, [yRows]);

  return rows;
}

