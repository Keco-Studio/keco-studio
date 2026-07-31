'use client';

import { ScriptSidebar } from './ScriptSidebar';
import styles from './ScriptShell.module.css';

export type ScriptShellProps = {
  projectId: string;
  children: React.ReactNode;
};

export function ScriptShell({ projectId, children }: ScriptShellProps) {
  return (
    <div className={styles.root} data-script-root>
      <ScriptSidebar projectId={projectId} />
      <div className={styles.main}>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
