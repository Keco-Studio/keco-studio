'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { DESKTOP_MODE_STORAGE_KEY, isDesktopModeSearch } from '@/lib/desktopMode';

export function DesktopModeMarker() {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (isDesktopModeSearch(`?${searchParams.toString()}`)) {
      window.sessionStorage.setItem(DESKTOP_MODE_STORAGE_KEY, '1');
    }
  }, [searchParams]);

  return null;
}
