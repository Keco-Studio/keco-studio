'use client';

import { usePathname } from 'next/navigation';
import { ScriptSidebar } from './ScriptSidebar';
import styles from './ScriptShell.module.css';

export type ScriptShellProps = {
  projectId: string;
  children: React.ReactNode;
};

export function ScriptShell({ projectId, children }: ScriptShellProps) {
  const pathname = usePathname();
  const flushMain =
    pathname?.includes(`/script-system/${projectId}/doc/`) ||
    pathname?.includes(`/script-system/${projectId}/script/`);

  return (
    <div className={styles.root} data-script-root>
      <ScriptSidebar projectId={projectId} />
      <div className={styles.main}>
        <div
          className={`${styles.content} ${flushMain ? styles.contentFlush : ''}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
