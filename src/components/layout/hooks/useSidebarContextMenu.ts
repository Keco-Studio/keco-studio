'use client';

import { useState, useCallback } from 'react';

export type SidebarContextMenuType = 'project' | 'library' | 'folder' | 'asset';

export type SidebarContextMenuState = {
  x: number;
  y: number;
  type: SidebarContextMenuType;
  id: string;
  // Store element reference for scroll tracking
  elementRef: HTMLElement | null;
} | null;

/**
 * Centralizes context menu position, type, target id and close logic for the Sidebar.
 */
export function useSidebarContextMenu() {
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState>(null);

  const openContextMenu = useCallback(
    (x: number, y: number, type: SidebarContextMenuType, id: string, elementRef?: HTMLElement | null) => {
      setContextMenu({ x, y, type, id, elementRef: elementRef || null });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return { contextMenu, openContextMenu, closeContextMenu };
}
