'use client';

import styles from './ScriptWorkspaceToolbar.module.css';

export type ScriptWorkspaceToolbarProps = {
  libraryName: string;
  issueCount: number;
  isSaving: boolean;
  saveStatus?: string;
  onOpenTemplates: () => void;
  onSaveAsTemplate: () => void;
  onOpenChecks: () => void;
  onSave: () => void;
};

export function ScriptWorkspaceToolbar({
  libraryName,
  issueCount,
  isSaving,
  saveStatus,
  onOpenTemplates,
  onSaveAsTemplate,
  onOpenChecks,
  onSave,
}: ScriptWorkspaceToolbarProps) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.identity}>
        <span className={styles.section}>剧情脚本</span>
        <span className={styles.separator} aria-hidden="true">/</span>
        <h1 className={styles.libraryName}>{libraryName}</h1>
      </div>
      <div className={styles.actions}>
        {saveStatus ? <span className={styles.status} role="status">{saveStatus}</span> : null}
        <button type="button" className={styles.button} onClick={onOpenTemplates}>模板</button>
        <button type="button" className={styles.button} onClick={onSaveAsTemplate}>保存为模板</button>
        <button
          type="button"
          className={styles.button}
          aria-label={`结构检查，${issueCount} 个问题`}
          onClick={onOpenChecks}
        >
          结构检查
          {issueCount > 0 ? <span className={styles.issueCount}>{issueCount}</span> : null}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          aria-label="保存脚本"
          disabled={isSaving}
          onClick={onSave}
        >
          {isSaving ? '保存中…' : '保存'}
        </button>
      </div>
    </header>
  );
}
