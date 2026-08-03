import React from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { SectionTabs } from './SectionTabs';
import { TableCellFindReplace } from './TableCellFindReplace';
import type { PropertyGroup } from '../utils/tableStructure';
import styles from '../LibraryAssetsTable.module.css';

type SupabaseSessionClient = {
  auth: {
    getSession: () => Promise<{
      data?: {
        session?: {
          access_token?: string;
        } | null;
      } | null;
    }>;
  };
};

type LibraryTableTopBarProps = {
  hasSections: boolean;
  groups: PropertyGroup[];
  activeSectionId: string | null;
  editingSectionId: string | null;
  editingSectionName: string;
  sectionInputRef: React.RefObject<HTMLInputElement>;
  canAddSection: boolean;
  canManageSections?: boolean;
  hasScriptColumns: boolean;
  scriptViewMode: 'table' | 'script';
  /** When false, hide Table/Script conversion toggle (script-only libraries). */
  showScriptViewToggle?: boolean;
  libraryId: string | undefined;
  rows: AssetRow[];
  properties: PropertyConfig[];
  canReplace: boolean;
  supabase: SupabaseSessionClient;
  onSelectSection: (sectionId: string) => void;
  onStartSectionEdit: (sectionId: string, currentName: string) => void;
  onChangeSectionName: (name: string) => void;
  onFinishSectionEdit: (submit: boolean) => void;
  onAddSection: () => Promise<void>;
  onRequestDeleteSection?: (sectionId: string, sectionName: string) => void;
  onChangeScriptViewMode: (mode: 'table' | 'script') => void;
  onHighlightCells: (cells: Array<{ assetId: string; fieldId: string }>) => void;
  onClearHighlight: () => void;
  onFocusSection?: (sectionId: string) => void;
  scrollToCell: (assetId: string, fieldId: string) => void;
};

export function LibraryTableTopBar({
  hasSections,
  groups,
  activeSectionId,
  editingSectionId,
  editingSectionName,
  sectionInputRef,
  canAddSection,
  canManageSections = false,
  hasScriptColumns,
  scriptViewMode,
  showScriptViewToggle = true,
  libraryId,
  rows,
  properties,
  canReplace,
  supabase,
  onSelectSection,
  onStartSectionEdit,
  onChangeSectionName,
  onFinishSectionEdit,
  onAddSection,
  onRequestDeleteSection,
  onChangeScriptViewMode,
  onHighlightCells,
  onClearHighlight,
  onFocusSection,
  scrollToCell,
}: LibraryTableTopBarProps) {
  const getAccessToken = React.useCallback(async () => {
    const sessionRes = await supabase.auth.getSession();
    return sessionRes.data?.session?.access_token;
  }, [supabase]);

  return (
    <div className={styles.tableTopBar}>
      {hasSections && scriptViewMode !== 'script' ? (
        <SectionTabs
          groups={groups}
          activeSectionId={activeSectionId}
          editingSectionId={editingSectionId}
          editingSectionName={editingSectionName}
          sectionInputRef={sectionInputRef}
          canAddSection={canAddSection}
          canManageSections={canManageSections}
          onSelectSection={onSelectSection}
          onStartEdit={onStartSectionEdit}
          onChangeEditingName={onChangeSectionName}
          onFinishEdit={onFinishSectionEdit}
          onAddSection={onAddSection}
          onRequestDeleteSection={onRequestDeleteSection}
        />
      ) : (
        <div className={styles.tableTopBarSpacer} />
      )}
      {hasScriptColumns && showScriptViewToggle && (
        <div className={styles.viewToggleGroup}>
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${scriptViewMode === 'table' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => onChangeScriptViewMode('table')}
          >
            Table
          </button>
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${scriptViewMode === 'script' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => onChangeScriptViewMode('script')}
          >
            Script
          </button>
        </div>
      )}
      <div className={styles.tableTopBarFindWrap}>
        <TableCellFindReplace
          libraryId={libraryId}
          rows={rows}
          properties={properties}
          canReplace={canReplace}
          getAccessToken={getAccessToken}
          onHighlightCells={onHighlightCells}
          onClearHighlight={onClearHighlight}
          onFocusSection={onFocusSection}
          scrollToCell={scrollToCell}
        />
      </div>
    </div>
  );
}
