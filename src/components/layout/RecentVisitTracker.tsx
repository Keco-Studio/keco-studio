'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { useSupabase } from '@/lib/SupabaseContext';
import { writeRecentVisit } from '@/lib/recentVisits/storage';
import {
  writeStudioFilePreference,
  writeStudioProjectPreference,
} from '@/lib/studio/navigationPreference';
import { getProductNavigationState } from '@/lib/create-map/productNavigation';

/**
 * Records recently opened tables and documents (not script libraries / assets).
 */
export function RecentVisitTracker() {
  const supabase = useSupabase();
  const pathname = usePathname();
  const onStudio = getProductNavigationState(pathname).studio;
  const { userProfile } = useAuth();
  const {
    currentProjectId,
    currentLibraryId,
    currentLibraryName,
    currentDocumentId,
    currentDocumentName,
    currentAssetId,
  } = useNavigation();

  useEffect(() => {
    const userId = userProfile?.id;
    if (!userId || !currentProjectId) return;
    if (!onStudio) return;

    writeStudioProjectPreference(userId, currentProjectId);

    if (currentDocumentId && currentDocumentName) {
      const href = `/${currentProjectId}/doc/${currentDocumentId}`;
      writeStudioFilePreference(userId, currentProjectId, href);
      writeRecentVisit(userId, {
        kind: 'document',
        id: currentDocumentId,
        projectId: currentProjectId,
        name: currentDocumentName,
        href,
      });
      return;
    }

    // Table opens (library page, including when drilling into an asset).
    // Script libraries are excluded after a lightweight type check.
    if (currentLibraryId && currentLibraryName) {
      let cancelled = false;
      void (async () => {
        const { data } = await supabase
          .from('libraries')
          .select('document_export_type')
          .eq('id', currentLibraryId)
          .maybeSingle();
        if (cancelled) return;
        if (data?.document_export_type === 'script') return;

        const href = currentAssetId
          ? `/${currentProjectId}/${currentLibraryId}?asset=${currentAssetId}`
          : `/${currentProjectId}/${currentLibraryId}`;
        writeStudioFilePreference(userId, currentProjectId, href);
        writeRecentVisit(userId, {
          kind: 'table',
          id: currentLibraryId,
          projectId: currentProjectId,
          name: currentLibraryName,
          href,
        });
      })();

      return () => {
        cancelled = true;
      };
    }
  }, [
    currentAssetId,
    currentDocumentId,
    currentDocumentName,
    currentLibraryId,
    currentLibraryName,
    currentProjectId,
    onStudio,
    supabase,
    userProfile?.id,
  ]);

  return null;
}
