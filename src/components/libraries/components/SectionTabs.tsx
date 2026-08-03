import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { Input } from 'antd';
import type { PropertyGroup } from '../utils/tableStructure';
import addSectionIcon from '@/assets/images/addProjectIcon.svg';
import menuStyles from '../AddLibraryMenu.module.css';
import styles from '../LibraryAssetsTable.module.css';

type SectionTabMenuState = {
  x: number;
  y: number;
  sectionId: string;
  sectionName: string;
};

type SectionTabsProps = {
  groups: PropertyGroup[];
  activeSectionId: string | null;
  editingSectionId: string | null;
  editingSectionName: string;
  sectionInputRef: React.RefObject<HTMLInputElement>;
  canAddSection: boolean;
  canManageSections?: boolean;
  onSelectSection: (sectionId: string) => void;
  onStartEdit: (sectionId: string, currentName: string) => void;
  onChangeEditingName: (name: string) => void;
  onFinishEdit: (submit: boolean) => void;
  onAddSection: () => Promise<void>;
  onRequestDeleteSection?: (sectionId: string, sectionName: string) => void;
};

export function SectionTabs({
  groups,
  activeSectionId,
  editingSectionId,
  editingSectionName,
  sectionInputRef,
  canAddSection,
  canManageSections = false,
  onSelectSection,
  onStartEdit,
  onChangeEditingName,
  onFinishEdit,
  onAddSection,
  onRequestDeleteSection,
}: SectionTabsProps) {
  const [menu, setMenu] = useState<SectionTabMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const canDeleteSection = groups.length > 1 && !!onRequestDeleteSection;

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const handleScroll = () => closeMenu();

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [menu, closeMenu]);

  useEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    let nextX = menu.x;
    let nextY = menu.y;
    if (rect.right > window.innerWidth) {
      nextX = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (rect.bottom > window.innerHeight) {
      nextY = Math.max(8, window.innerHeight - rect.height - 8);
    }
    if (nextX !== menu.x || nextY !== menu.y) {
      el.style.left = `${nextX}px`;
      el.style.top = `${nextY}px`;
    }
  }, [menu]);

  const handleContextMenu = (
    event: React.MouseEvent,
    sectionId: string,
    sectionName: string
  ) => {
    if (!canManageSections) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectSection(sectionId);
    setMenu({ x: event.clientX, y: event.clientY, sectionId, sectionName });
  };

  return (
    <div className={styles.sectionTabs}>
      {groups.map((group) => (
        editingSectionId === group.section.id ? (
          <div key={group.section.id} className={styles.sectionTabEdit}>
            <Input
              ref={sectionInputRef}
              value={editingSectionName}
              onChange={(event) => onChangeEditingName(event.target.value)}
              onBlur={() => onFinishEdit(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onFinishEdit(true);
                if (event.key === 'Escape') onFinishEdit(false);
              }}
              className={styles.sectionTabInput}
              size="small"
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        ) : (
          <button
            key={group.section.id}
            type="button"
            className={`${styles.sectionTab} ${activeSectionId === group.section.id ? styles.sectionTabActive : ''}`}
            onClick={() => onSelectSection(group.section.id)}
            onDoubleClick={(event) => {
              event.preventDefault();
              if (!canManageSections) return;
              onStartEdit(group.section.id, group.section.name);
            }}
            onContextMenu={(event) =>
              handleContextMenu(event, group.section.id, group.section.name)
            }
          >
            {group.section.name}
          </button>
        )
      ))}

      <button
        type="button"
        className={styles.addSectionButton}
        onClick={onAddSection}
        aria-label="Add section"
        disabled={!canAddSection}
      >
        <Image src={addSectionIcon} alt="Add section" width={16} height={16} />
      </button>

      {menu && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              className={menuStyles.menu}
              style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1100 }}
              role="menu"
            >
              <button
                type="button"
                className={menuStyles.menuItem}
                role="menuitem"
                onClick={() => {
                  const { sectionId, sectionName } = menu;
                  closeMenu();
                  onStartEdit(sectionId, sectionName);
                }}
              >
                Rename
              </button>
              {canDeleteSection && (
                <button
                  type="button"
                  className={`${menuStyles.menuItem} ${menuStyles.deleteItem}`}
                  role="menuitem"
                  onClick={() => {
                    const { sectionId, sectionName } = menu;
                    closeMenu();
                    onRequestDeleteSection?.(sectionId, sectionName);
                  }}
                >
                  Delete
                </button>
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
