'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ObservableRowStore } from '@/lib/library/rowStore';

const RowStoreContext = createContext<ObservableRowStore | null>(null);

export function RowStoreProvider({
  children,
  libraryId,
}: {
  children: ReactNode;
  libraryId: string;
}) {
  const rowStore = useMemo(() => {
    void libraryId;
    return new ObservableRowStore();
  }, [libraryId]);

  return (
    <RowStoreContext.Provider value={rowStore}>
      {children}
    </RowStoreContext.Provider>
  );
}

export function useRowStore(): ObservableRowStore {
  const context = useContext(RowStoreContext);
  if (!context) throw new Error('useRowStore must be used within RowStoreProvider');
  return context;
}
