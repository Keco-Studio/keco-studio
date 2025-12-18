'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import menuDivider from '@/app/assets/images/menuDivider.svg';
import styles from './LibraryCardMenu.module.css';

type LibraryCardMenuProps = {
  isOpen: boolean;
  onClose: () => void;
  anchorElement: HTMLElement | null;
  onExport?: () => void;
  onVersionHistory?: () => void;
  onCreateBranch?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onMoveTo?: () => void;
  onDelete?: () => void;
};

export function LibraryCardMenu({
  isOpen,
  onClose,
  anchorElement,
  onExport,
  onVersionHistory,
  onCreateBranch,
  onRename,
  onDuplicate,
  onMoveTo,
  onDelete,
}: LibraryCardMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        anchorElement &&
        !anchorElement.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, anchorElement]);

  useEffect(() => {
    if (!isOpen || !menuRef.current || !anchorElement) return;

    const updatePosition = () => {
      const anchorRect = anchorElement.getBoundingClientRect();
      const menu = menuRef.current;
      if (!menu) return;

      // 窗口上边界和三个点框线下边界重合
      // 窗口右边界和三个点右边界在一条竖直线上
      const top = anchorRect.bottom;
      const menuWidth = menu.offsetWidth || menu.getBoundingClientRect().width;
      const left = anchorRect.right - menuWidth;

      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.right = 'auto';
    };

    // 使用 requestAnimationFrame 确保菜单已渲染并可以获取宽度
    requestAnimationFrame(() => {
      updatePosition();
    });

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, anchorElement]);

  if (!isOpen) return null;

  return (
    <div ref={menuRef} className={styles.menu}>
      <button className={styles.menuItem} onClick={onExport}>
        Export library
      </button>
      <button className={styles.menuItem} onClick={onVersionHistory}>
        Version history
      </button>
      <button className={styles.menuItem} onClick={onCreateBranch}>
        Create branch
      </button>
      <div className={styles.divider}>
        <Image src={menuDivider} alt="" width={224} height={1} />
      </div>
      <button className={styles.menuItem} onClick={onRename}>
        Rename
      </button>
      <button className={styles.menuItem} onClick={onDuplicate}>
        Duplicate
      </button>
      <button className={styles.menuItem} onClick={onMoveTo}>
        Move to...
      </button>
      <button className={styles.menuItem} onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

