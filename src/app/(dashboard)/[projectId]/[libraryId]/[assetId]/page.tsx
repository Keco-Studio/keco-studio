'use client';

/**
 * Full-page asset detail was removed. Keep this route as a compatibility
 * redirect so old links and bookmarks land on the library table with the row
 * highlighted via ?asset=.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { isUuid } from '@/lib/utils/uuid';

export default function AssetPageRedirect() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;
  const assetId = params.assetId as string;

  useEffect(() => {
    if (!projectId || !libraryId) return;
    if (assetId === 'new' || !isUuid(assetId)) {
      router.replace(`/${projectId}/${libraryId}`);
      return;
    }
    router.replace(`/${projectId}/${libraryId}?asset=${assetId}`);
  }, [assetId, libraryId, projectId, router]);

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      Opening library table…
    </div>
  );
}
