'use client';

import styles from './ShareButton.module.css';

type ShareButtonProps = {
  onClick: () => void;
  className?: string;
};

export function ShareButton({ onClick, className }: ShareButtonProps) {
  return (
    <button
      type="button"
      className={className ? `${styles.shareButton} ${className}` : styles.shareButton}
      aria-label="Share"
      title="Share"
      onClick={onClick}
    >
      Share
    </button>
  );
}
