import Image from 'next/image';
import collaborationViewNumIcon from '@/assets/images/collaborationViewNumIcon.svg';
import styles from '../LibraryAssetsTable.module.css';

type ViewerBannerProps = {
  visible: boolean;
  onDismiss: () => void;
};

export function ViewerBanner({ visible, onDismiss }: ViewerBannerProps) {
  if (!visible) return null;

  return (
    <div className={styles.viewerBanner}>
      <Image
        src={collaborationViewNumIcon}
        alt="View"
        width={20}
        height={20}
        className={`icon-20 ${styles.viewerBannerIcon}`}
      />
      <span className={styles.viewerBannerText}>You can only view this library.</span>
      <button
        className={styles.viewerBannerClose}
        onClick={onDismiss}
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}
