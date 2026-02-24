/**
 * Library Layout
 * 
 * Wraps all library-related pages with:
 * - LibraryDataProvider (unified data management)
 * 
 * This ensures both LibraryAssetsTable and AssetPage share the same data source.
 */

'use client';

import { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { LibraryDataProvider } from '@/lib/contexts/LibraryDataContext';

interface LibraryLayoutProps {
  children: ReactNode;
}

export default function LibraryLayout({ children }: LibraryLayoutProps) {
  const params = useParams();
  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;
  
  if (!libraryId || !projectId) {
    return <>{children}</>;
  }
  
  return (
    <LibraryDataProvider libraryId={libraryId} projectId={projectId}>
      {children}
    </LibraryDataProvider>
  );
}







