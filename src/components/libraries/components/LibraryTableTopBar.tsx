import React from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { TableCellFindReplace } from './TableCellFindReplace';
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
  hasScriptColumns: boolean;
  scriptViewMode: 'table' | 'script';
  /** When false, hide Table/Script conversion toggle (script-only libraries). */
  showScriptViewToggle?: boolean;
  libraryId: string | undefined;
  rows: AssetRow[];
  properties: PropertyConfig[];
  canReplace: boolean;
  supabase: SupabaseSessionClient;
  onChangeScriptViewMode: (mode: 'table' | 'script') => void;
  onHighlightCells: (cells: Array<{ assetId: string; fieldId: string }>) => void;
  onClearHighlight: () => void;
  scrollToCell: (assetId: string, fieldId: string) => void;
};

export function LibraryTableTopBar({
  hasScriptColumns,
  scriptViewMode,
  showScriptViewToggle = true,
  libraryId,
  rows,
  properties,
  canReplace,
  supabase,
  onChangeScriptViewMode,
  onHighlightCells,
  onClearHighlight,
  scrollToCell,
}: LibraryTableTopBarProps) {
  const getAccessToken = React.useCallback(async () => {
    const sessionRes = await supabase.auth.getSession();
    return sessionRes.data?.session?.access_token;
  }, [supabase]);

  return (
    <div className={styles.tableTopBar}>
      <div className={styles.tableTopBarSpacer} />
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
          scrollToCell={scrollToCell}
        />
      </div>
    </div>
  );
}
