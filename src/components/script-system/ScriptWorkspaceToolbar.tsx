'use client';

import styles from './ScriptWorkspaceToolbar.module.css';

export type ScriptWorkspaceToolbarProps = {
  libraryName: string;
};

export function ScriptWorkspaceToolbar({
  libraryName,
}: ScriptWorkspaceToolbarProps) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.identity}>
        <span className={styles.section}>Story Script</span>
        <span className={styles.separator} aria-hidden="true">/</span>
        <h1 className={styles.libraryName}>{libraryName}</h1>
      </div>
    </header>
  );
}
