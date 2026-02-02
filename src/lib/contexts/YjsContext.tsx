/**
 * Yjs Context Provider
 * 
 * Provides Yjs document and shared array to all child components
 * Mainly used to solve row ordering issues in single-user scenarios (unified data source, ID-based operations)
 * Can be extended to support multi-user collaboration in the future
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
  // Create an independent document for each library
  const ydoc = useMemo(() => new Y.Doc(), [libraryId]);
  const yRows = useMemo(() => ydoc.getArray<AssetRow>('rows'), [ydoc]);
  
  const [isConnected, setIsConnected] = useState(false);

  // Local persistence (IndexedDB) - supports offline editing and state recovery
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

