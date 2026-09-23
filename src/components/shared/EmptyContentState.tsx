import Image from 'next/image';
import recentEmptyIcon from '@/assets/images/nav-icons/computer.svg';
import styles from './EmptyContentState.module.css';

type EmptyContentStateProps = {
  message: string;
  children?: React.ReactNode;
  className?: string;
  compact?: boolean;
};

export function EmptyContentState({ message, children, className, compact = false }: EmptyContentStateProps) {
  return (
    <div className={`${styles.emptyContentState}${compact ? ` ${styles.compact}` : ''}${className ? ` ${className}` : ''}`} data-testid="empty-content-state">
      <div className={styles.content}>
        <Image
          src={recentEmptyIcon}
          alt=""
          width={88}
          height={88}
          className={styles.emptyIcon}
          priority
        />
        <p className={styles.emptyText}>{message}</p>
      </div>
      {children ? <div className={styles.actions}>{children}</div> : null}
    </div>
  );
}
