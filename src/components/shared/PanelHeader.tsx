'use client';

import Image from 'next/image';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import addIcon from '@/assets/images/add.svg';
import closeIcon from '@/assets/images/close.svg';
import styles from './PanelHeader.module.css';

const ICON_SIZE = 20;

export type PanelIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function PanelIconButton({
  active = false,
  className,
  type = 'button',
  children,
  ...props
}: PanelIconButtonProps) {
  return (
    <button
      type={type}
      className={[styles.iconButton, active ? styles.iconButtonActive : '', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </button>
  );
}

export type PanelHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  hideClose?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  addDisabled?: boolean;
  hideAdd?: boolean;
  actions?: ReactNode;
  className?: string;
  titleAs?: 'h2' | 'span';
};

export function PanelHeader({
  title,
  subtitle,
  leading,
  onClose,
  closeLabel = 'Close',
  hideClose = false,
  onAdd,
  addLabel = 'Add',
  addDisabled = false,
  hideAdd = false,
  actions,
  className,
  titleAs = 'h2',
}: PanelHeaderProps) {
  const TitleTag = titleAs;
  const showAdd = Boolean(onAdd) && !hideAdd;
  const showClose = Boolean(onClose) && !hideClose;

  return (
    <header className={[styles.header, className].filter(Boolean).join(' ')}>
      <div className={styles.identity}>
        {leading}
        <div className={styles.titleGroup}>
          <TitleTag className={styles.title}>{title}</TitleTag>
          {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
        </div>
      </div>

      <div className={styles.actions}>
        {actions}
        {showAdd ? (
          <PanelIconButton
            onClick={onAdd}
            disabled={addDisabled}
            aria-label={addLabel}
            title={addLabel}
          >
            <Image
              src={addIcon}
              alt=""
              width={ICON_SIZE}
              height={ICON_SIZE}
              aria-hidden="true"
            />
          </PanelIconButton>
        ) : null}
        {showClose ? (
          <PanelIconButton onClick={onClose} aria-label={closeLabel} title={closeLabel}>
            <Image
              src={closeIcon}
              alt=""
              width={ICON_SIZE}
              height={ICON_SIZE}
              aria-hidden="true"
            />
          </PanelIconButton>
        ) : null}
      </div>
    </header>
  );
}

export default PanelHeader;
