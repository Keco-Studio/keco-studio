'use client';

import Image from 'next/image';
import moreOptionsIcon from '@/assets/images/moreOptionsIcon.svg';
import paperIcon from '@/assets/images/paper.svg';
import { requestDocumentContextMenu } from '@/components/documents/documentContextMenuRequest';
import styles from './DocumentRecentCard.module.css';

type DocumentRecentCardProps = {
  documentId: string;
  name: string;
  description?: string | null;
  onClick?: () => void;
};

export function DocumentRecentCard({ documentId, name, description, onClick }: DocumentRecentCardProps) {
  return (
    <div className={styles.card} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className={styles.thumbnailContainer} aria-hidden>
        <div className={styles.documentPreview}>
          <span className={styles.previewLine} style={{ width: '72%' }} />
          <span className={styles.previewLine} style={{ width: '88%' }} />
          <span className={styles.previewLine} style={{ width: '64%' }} />
          <span className={styles.previewLine} style={{ width: '80%' }} />
          <span className={styles.previewBlock} />
        </div>
      </div>
      <div className={styles.cardFooter}>
        <div className={styles.docInfo}>
          <div className={styles.docIconContainer}>
            <Image src={paperIcon} alt="" width={24} height={24} className="icon-24" />
          </div>
          <div className={styles.docNameContainer}>
            <span className={styles.docName}>{name}</span>
            <span className={styles.docMeta}>{description?.trim() || 'Document'}</span>
          </div>
        </div>
        <button
          type="button"
          className={styles.actionButton}
          aria-label="More options"
          onClick={(event) => {
            event.stopPropagation();
            requestDocumentContextMenu(documentId, event.currentTarget);
          }}
        >
          <Image src={moreOptionsIcon} alt="" width={20} height={20} className="icon-20" />
        </button>
      </div>
    </div>
  );
}
