'use client';

import React, { useCallback } from 'react';
import Image from 'next/image';
import { Avatar } from 'antd';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import { getAssetAvatarColor, getAssetAvatarText } from '@/components/libraries/utils/libraryAssetUtils';
import referenceAddIcon from '@/assets/images/referenceAdd.svg';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export type ReferenceFieldProps = {
  property: PropertyConfig;
  assetIds: string[];
  rowId: string;
  assetNamesCache: Record<string, string>;
  isCellSelected: boolean;
  avatarRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onAvatarMouseEnter: (assetId: string, element: HTMLDivElement) => void;
  onAvatarMouseLeave: () => void;
  onOpenReferenceModal: (property: PropertyConfig, currentValue: string[] | null, rowId: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
};

export const ReferenceField = React.memo<ReferenceFieldProps>(function ReferenceField({
  property,
  assetIds,
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
  const hasValues = assetIds.length > 0;
  const selectedAssetIds = assetIds.slice(0, 2);
  const extraCount = Math.max(0, assetIds.length - selectedAssetIds.length);

  const getAssetName = (id: string) => assetNamesCache[id] ?? id;

  // Avoid squeezing: when showing 2 avatars, expand the pill width by one tile.
  const pillWidthStyle: React.CSSProperties | undefined =
    selectedAssetIds.length <= 1
      ? undefined
      : {
          width: 'calc(3.25rem + 1.375rem)',
        };

  const setAvatarRef = useCallback(
    (assetId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        avatarRefs.current.set(assetId, el);
        return;
      }
      const existing = avatarRefs.current.get(assetId);
      if (existing) avatarRefs.current.delete(assetId);
    },
    [avatarRefs]
  );

  const handleClick = (e: React.MouseEvent) => {
    if (isCellSelected) {
      e.stopPropagation();
      e.preventDefault();
      // Call onFocus when opening reference modal
      onFocus?.();
      onOpenReferenceModal(property, hasValues ? assetIds : null, rowId);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isCellSelected) e.stopPropagation();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className={styles.referenceFieldWrapper}
    >
      {hasValues ? (
        <div
          className={styles.referenceSelectedAssetLeft}
          data-reference-background="true"
          style={pillWidthStyle}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          <div className={styles.referenceAvatarsStack}>
            {selectedAssetIds.map((id, idx) => {
              const name = getAssetName(id);
              return (
                <div
                  key={id}
                  ref={setAvatarRef(id)}
                  onMouseEnter={(e) => {
                    e.stopPropagation();
                  }}
                  onMouseLeave={(e) => {
                    e.stopPropagation();
                  }}
                  className={`${styles.referenceAvatarWrapper} ${styles.referenceAvatarStackItem}`}
                  style={{}}
                >
                  <Avatar
                    size={16}
                    style={{
                      backgroundColor: getAssetAvatarColor(id, name),
                      borderRadius: '2.4px',
                    }}
                    className={styles.referenceAvatar}
                  >
                    {getAssetAvatarText(name)}
                  </Avatar>
                  {idx === selectedAssetIds.length - 1 && extraCount > 0 ? (
                    <span
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -8,
                        fontSize: 10,
                        color: '#0B99FF',
                        fontWeight: 700,
                        pointerEvents: 'none',
                      }}
                    >
                      +{extraCount}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className={`${styles.referenceIconTile} ${styles.referenceArrowTile}`}>
            <Image
              src={referenceAddIcon}
              alt=""
              width={16}
              height={16}
              className={styles.referenceExpandIcon}
            />
          </div>
        </div>
      ) : (
        <div
          className={`${styles.referenceIconTile} ${styles.referenceArrowTile} ${styles.referenceSingleIcon}`}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          <Image
            src={referenceAddIcon}
            alt=""
            width={16}
            height={16}
            className={styles.referenceArrowIcon}
          />
        </div>
      )}
    </div>
  );
});

export default ReferenceField;
