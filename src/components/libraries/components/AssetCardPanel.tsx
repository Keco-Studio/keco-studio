'use client';

import { createPortal } from 'react-dom';
import Image from 'next/image';
import { Avatar, Spin } from 'antd';
import { getAssetAvatarColor, getAssetAvatarText } from '@/components/libraries/utils/libraryAssetUtils';
import libraryAssetTable5Icon from '@/assets/images/LibraryAssetTable5.svg';
import libraryAssetTable6Icon from '@/assets/images/LibraryAssetTable6.svg';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export type AssetCardDetails = {
  name: string;
  libraryId: string;
  libraryName: string;
};

export type AssetCardPanelProps = {
  visible: boolean;
  position: { x: number; y: number };
  assetId: string | null;
  details: AssetCardDetails | null;
  loading: boolean;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onLibraryClick?: (libraryId: string) => void;
};

export function AssetCardPanel({
  visible,
  position,
  assetId,
  details,
  loading,
  onClose,
  onMouseEnter,
  onMouseLeave,
  onLibraryClick,
}: AssetCardPanelProps) {
  if (!visible || !position || typeof document === 'undefined') return null;

  const { x, y } = position;

  return createPortal(
    <>
      <div
        className={styles.assetCardBridge}
        style={{ left: `${x - 40}px`, top: `${y}px` }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
      <div
        className={styles.assetCardPanel}
        style={{ left: `${x}px`, top: `${y}px` }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className={styles.assetCardHeader}>
          <div className={styles.assetCardTitle}>ASSET CARD</div>
          <button
            className={styles.assetCardCloseButton}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className={styles.assetCardContent}>
          {loading ? (
            <div className={styles.assetCardLoading}>
              <Spin />
            </div>
          ) : details ? (
            <div className={styles.assetCardDetailsSection}>
              <div className={styles.assetCardDetailsLabel}>Details</div>
              <div className={styles.assetCardDetailsContent}>
                <div className={styles.assetCardDetailRow}>
                  <div className={styles.assetCardIconWrapper}>
                    <Avatar
                      size={48}
                      style={{
                        backgroundColor: assetId ? getAssetAvatarColor(assetId, details.name) : '#FF6CAA',
                        borderRadius: '6px',
                      }}
                      className={styles.assetCardIconAvatar}
                    >
                      {getAssetAvatarText(details.name)}
                    </Avatar>
                  </div>
                  <div className={styles.assetCardDetailInfo}>
                    <div className={styles.assetCardDetailItem}>
                      <span className={styles.assetCardDetailLabel}>Name</span>
                      <span className={styles.assetCardDetailValue}>{details.name}</span>
                    </div>
                    <div className={styles.assetCardDetailItem}>
                      <span className={styles.assetCardDetailLabel}>From Library</span>
                      <div
                        className={styles.assetCardLibraryLink}
                        onClick={() => onLibraryClick?.(details.libraryId)}
                        style={{ cursor: onLibraryClick ? 'pointer' : 'default' }}
                      >
                        <Image src={libraryAssetTable5Icon} alt="" width={16} height={16} className={`icon-16 ${styles.assetCardLibraryIcon}`} />
                        <span className={styles.assetCardLibraryName}>{details.libraryName}</span>
                        <Image src={libraryAssetTable6Icon} alt="" width={16} height={16} className={`icon-16 ${styles.assetCardLibraryArrow}`} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>,
    document.body
  );
}
