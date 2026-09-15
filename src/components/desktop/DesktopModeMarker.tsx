'use client';

import { useEffect } from 'react';
import { DESKTOP_MODE_STORAGE_KEY, isDesktopModeSearch } from '@/lib/desktopMode';

export function DesktopModeMarker() {
  useEffect(() => {
    if (isDesktopModeSearch(window.location.search)) {
      window.sessionStorage.setItem(DESKTOP_MODE_STORAGE_KEY, '1');
    }
  }, []);

  return null;
}
