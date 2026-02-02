'use client';

import React, { useState, useRef, useCallback } from 'react';
import Image from 'next/image';
import { Avatar } from 'antd';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import { getAssetAvatarColor, getAssetAvatarText } from '@/components/libraries/utils/libraryAssetUtils';
import libraryAssetTableIcon from '@/assets/images/LibraryAssetTableIcon.svg';
import libraryAssetTable2Icon from '@/assets/images/LibraryAssetTable2.svg';
import libraryAssetTable3Icon from '@/assets/images/LibraryAssetTable3.svg';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export type ReferenceFieldProps = {
  property: PropertyConfig;
  assetId: string | null;
  rowId: string;
  assetNamesCache: Record<string, string>;
  isCellSelected: boolean;
  avatarRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onAvatarMouseEnter: (assetId: string, element: HTMLDivElement) => void;
  onAvatarMouseLeave: () => void;
  onOpenReferenceModal: (property: PropertyConfig, currentValue: string | null, rowId: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
};

export const ReferenceField = React.memo<ReferenceFieldProps>(function ReferenceField({
  property,
  assetId,
  rowId,
  assetNamesCache,
  isCellSelected,
  avatarRefs,
  onAvatarMouseEnter,
  onAvatarMouseLeave,
  onOpenReferenceModal,
  onFocus,
  onBlur,
}) {
  const hasValue = assetId != null && assetId.trim() !== '';
  const assetName = hasValue ? (assetNamesCache[assetId] ?? assetId) : '';
  const [isHovered, setIsHovered] = useState(false);
  const avatarRef = useRef<HTMLDivElement | null>(null);

  const setAvatarRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && assetId) {
        avatarRef.current = el;
        avatarRefs.current.set(assetId, el);
      } else if (!el && assetId && avatarRefs.current.get(assetId) === avatarRef.current) {
        avatarRefs.current.delete(assetId);
      }
    },
    [assetId, avatarRefs]
  );

  const handleClick = (e: React.MouseEvent) => {
    if (isCellSelected) {
      e.stopPropagation();
      e.preventDefault();
      // Call onFocus when opening reference modal
      onFocus?.();
      onOpenReferenceModal(property, assetId, rowId);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isCellSelected) e.stopPropagation();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleMouseLeave = (e: React.MouseEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsHovered(false);
    }
  };

  return (
    <div
      className={styles.referenceFieldWrapper}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className={styles.referenceSelectedAssetLeft}
        data-reference-background="true"
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <Image
          src={libraryAssetTableIcon}
          alt=""
          width={16}
          height={16}
          className={`icon-16 ${styles.referenceDiamondIcon}`}
        />
        {hasValue && assetId ? (
          <>
            <div
              ref={setAvatarRef}
              onMouseEnter={(e) => {
                e.stopPropagation();
                setIsHovered(true);
              }}
              onMouseLeave={(e) => {
                e.stopPropagation();
                handleMouseLeave(e);
              }}
              className={styles.referenceAvatarWrapper}
            >
              <Avatar
                size={16}
                style={{
                  backgroundColor: getAssetAvatarColor(assetId, assetName),
                  borderRadius: '2.4px',
                }}
                className={styles.referenceAvatar}
              >
                {getAssetAvatarText(assetName)}
              </Avatar>
            </div>
            <Image
              src={isHovered ? libraryAssetTable3Icon : libraryAssetTable2Icon}
              alt=""
              width={16}
              height={16}
              className={styles.referenceExpandIcon}
              onMouseEnter={() => setIsHovered(true)}
            />
          </>
        ) : (
          <Image
            src={isHovered ? libraryAssetTable3Icon : libraryAssetTable2Icon}
            alt=""
            width={16}
            height={16}
            className={styles.referenceArrowIcon}
            onMouseEnter={() => setIsHovered(true)}
          />
        )}
      </div>
    </div>
  );
});

export default ReferenceField;
