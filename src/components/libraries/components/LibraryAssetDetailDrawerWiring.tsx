'use client';

import type React from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';
import { AssetDetailDrawer, type AssetDetailDrawerProps } from './AssetDetailDrawer';

const DETAIL_SLOT_ID = 'library-asset-detail-slot';

type LibraryAssetDetailDrawerWiringProps = {
  rowId: string | null;
  rows: AssetRow[];
  orderedProperties: PropertyConfig[];
  userRole: 'admin' | 'editor' | 'viewer' | null;
  assetNamesCache: Record<string, string>;
  avatarRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onClose: () => void;
  onUpdateRow: AssetDetailDrawerProps['onUpdateRow'];
  onMediaFileChange: (assetId: string, propertyKey: string, value: MediaFileMetadata | null) => void;
  onOpenReferenceModal: (property: PropertyConfig, currentValue: unknown, rowId: string) => void;
  onAvatarMouseEnter: (
    assetId: string,
    element: HTMLDivElement,
    selections?: Array<{ fieldLabel?: string | null; displayValue?: string | null }>
  ) => void;
  onAvatarMouseLeave: () => void;
};

export function LibraryAssetDetailDrawerWiring({
  rowId,
  rows,
  orderedProperties,
  userRole,
  assetNamesCache,
  avatarRefs,
  onClose,
  onUpdateRow,
  onMediaFileChange,
  onOpenReferenceModal,
  onAvatarMouseEnter,
  onAvatarMouseLeave,
}: LibraryAssetDetailDrawerWiringProps) {
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? document.getElementById(DETAIL_SLOT_ID) : null,
  );

  useEffect(() => {
    setSlotEl(document.getElementById(DETAIL_SLOT_ID));
  }, [rowId]);

  if (!rowId) return null;

  const drawerRow = rows.find((row) => row.id === rowId);
  if (!drawerRow) return null;

  const drawer = (
    <AssetDetailDrawer
      open={true}
      onClose={onClose}
      row={drawerRow}
      orderedProperties={orderedProperties}
      userRole={userRole}
      onUpdateRow={onUpdateRow}
      onMediaFileChange={onMediaFileChange}
      onOpenReferenceModal={onOpenReferenceModal}
      assetNamesCache={assetNamesCache}
      avatarRefs={avatarRefs}
      onAvatarMouseEnter={onAvatarMouseEnter}
      onAvatarMouseLeave={onAvatarMouseLeave}
    />
  );

  // Portal beside the table at mainContent level (same hierarchy as version history),
  // so Agent panel and asset detail can show side-by-side instead of overlapping.
  if (slotEl) {
    return createPortal(drawer, slotEl);
  }

  return drawer;
}
