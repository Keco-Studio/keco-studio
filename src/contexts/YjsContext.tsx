/**
 * Yjs Context Provider
 * 
 * 提供 Yjs 文档和共享数组给所有子组件
 * 主要用于解决单用户场景下的行混乱问题（统一数据源、基于ID操作）
 * 后续可以扩展支持多人协作
 */

'use client';

import React, { createContext, useContext, useMemo, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { AssetRow } from '@/lib/types/libraryAssets';

interface YjsContextType {
  ydoc: Y.Doc;
  yRows: Y.Array<AssetRow>;
  isConnected: boolean;
}

const YjsContext = createContext<YjsContextType | null>(null);

interface YjsProviderProps {
  children: React.ReactNode;
  libraryId: string;
}

export function YjsProvider({ children, libraryId }: YjsProviderProps) {
  // 为每个 library 创建独立的文档
  const ydoc = useMemo(() => new Y.Doc(), [libraryId]);
  const yRows = useMemo(() => ydoc.getArray<AssetRow>('rows'), [ydoc]);
  
  const [isConnected, setIsConnected] = useState(false);

  // 本地持久化（IndexedDB）- 支持离线编辑和状态恢复
  useEffect(() => {
    const persistence = new IndexeddbPersistence(`asset-table-${libraryId}`, ydoc);
    
    persistence.on('synced', () => {
      setIsConnected(true);
    });

    return () => {
      persistence.destroy();
    };
  }, [ydoc, libraryId]);

  return (
    <YjsContext.Provider value={{ ydoc, yRows, isConnected }}>
      {children}
    </YjsContext.Provider>
  );
}

export function useYjs() {
  const context = useContext(YjsContext);
  if (!context) {
    throw new Error('useYjs must be used within YjsProvider');
  }
  return context;
}

