'use client';

import styles from './ScriptWorkspaceToolbar.module.css';

export type ScriptWorkspaceToolbarProps = {
  libraryName: string;
  onOpenTemplates: () => void;
  onSaveAsTemplate: () => void;
};

export function ScriptWorkspaceToolbar({
  libraryName,
  onOpenTemplates,
  onSaveAsTemplate,
}: ScriptWorkspaceToolbarProps) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.identity}>
        <span className={styles.section}>剧情脚本</span>
        <span className={styles.separator} aria-hidden="true">/</span>
        <h1 className={styles.libraryName}>{libraryName}</h1>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onOpenTemplates}>模板</button>
        <button type="button" className={styles.button} onClick={onSaveAsTemplate}>保存为模板</button>
      </div>
    </header>
  );
}
