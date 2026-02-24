'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

type ToolbarSlotContextType = {
  toolbarSlot: HTMLDivElement | null;
  setToolbarSlot: (el: HTMLDivElement | null) => void;
};

const ToolbarSlotContext = createContext<ToolbarSlotContextType | null>(null);

export function ToolbarSlotProvider({ children }: { children: ReactNode }) {
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  return (
    <ToolbarSlotContext.Provider value={{ toolbarSlot, setToolbarSlot }}>
      {children}
    </ToolbarSlotContext.Provider>
  );
}

export function useToolbarSlot() {
  const context = useContext(ToolbarSlotContext);
  if (!context) {
    throw new Error('useToolbarSlot must be used within ToolbarSlotProvider');
  }
  return context;
}
