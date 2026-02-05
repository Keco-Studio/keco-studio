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
  firstColumnLabel?: string; // Label of the first column
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
                      <span className={styles.assetCardDetailLabel}>{details.firstColumnLabel || 'Name'}</span>
                      <span className={styles.assetCardDetailValue}>{details.name || 'Untitled'}</span>
                    </div>
                    <div className={styles.assetCardDetailItem}>
                      <span className={styles.assetCardDetailLabel}>From Library</span>
                      <div
                        className={styles.assetCardLibraryLink}
                        onClick={() => onLibraryClick?.(details.libraryId)}
                        style={{ cursor: onLibraryClick ? 'pointer' : 'default' }}
                      >
                        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={`icon-16 ${styles.assetCardLibraryIcon}`}>
                          <g clipPath="url(#clip0_libraryAssetTable5_card)">
                            <path d="M11.5895 4.41051L8.87497 1.69551C8.39164 1.21217 7.60831 1.21217 7.12498 1.69551L4.41042 4.41092M11.5895 4.41051L14.3041 7.12551C14.7874 7.60884 14.7874 8.39134 14.3041 8.87384L11.5895 11.5888M11.5895 4.41051L4.41126 11.5893M4.41126 11.5893L7.12665 14.3038C7.60915 14.7872 8.39164 14.7872 8.87497 14.3038L11.5895 11.5888M4.41126 11.5893L1.69586 8.87467C1.58092 8.75996 1.48972 8.6237 1.4275 8.4737C1.36528 8.3237 1.33325 8.1629 1.33325 8.00051C1.33325 7.83811 1.36528 7.67731 1.4275 7.52731C1.48972 7.37731 1.58092 7.24105 1.69586 7.12634L4.41042 4.41092M4.41042 4.41092L11.5895 11.5888" stroke="#0B99FF" strokeWidth="1.5"/>
                          </g>
                          <defs>
                            <clipPath id="clip0_libraryAssetTable5_card">
                              <rect width="16" height="16" fill="white"/>
                            </clipPath>
                          </defs>
                        </svg>
                        <span className={styles.assetCardLibraryName}>{details.libraryName}</span>
                        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={`icon-16 ${styles.assetCardLibraryArrow}`}>
                          <path d="M4.66675 11.3337L11.3334 4.66699" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M4.66675 4.66699H11.3334V11.3337" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
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
