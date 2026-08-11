'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { useSupabase } from '@/lib/SupabaseContext';
import { writeRecentVisit } from '@/lib/recentVisits/storage';

/**
 * Records recently opened tables and documents (not script libraries / assets).
 */
export function RecentVisitTracker() {
  const supabase = useSupabase();
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

    if (currentDocumentId && currentDocumentName) {
      writeRecentVisit(userId, {
        kind: 'document',
        id: currentDocumentId,
        projectId: currentProjectId,
        name: currentDocumentName,
        href: `/${currentProjectId}/doc/${currentDocumentId}`,
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

        writeRecentVisit(userId, {
          kind: 'table',
          id: currentLibraryId,
          projectId: currentProjectId,
          name: currentLibraryName,
          href: currentAssetId
            ? `/${currentProjectId}/${currentLibraryId}?asset=${currentAssetId}`
            : `/${currentProjectId}/${currentLibraryId}`,
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
    supabase,
    userProfile?.id,
  ]);

  return null;
}
