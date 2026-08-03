'use client';

import { usePathname } from 'next/navigation';
import styles from './ScriptShell.module.css';

export type ScriptShellProps = {
  projectId: string;
  children: React.ReactNode;
};

/**
 * Script main-content shell. The product sidebar is mounted by DashboardLayout
 * as a left sibling of TopBar so the nav bar only spans the content column.
 */
export function ScriptShell({ projectId, children }: ScriptShellProps) {
  const pathname = usePathname();
  const flushMain =
    pathname?.includes(`/script-system/${projectId}/doc/`) ||
    pathname?.includes(`/script-system/${projectId}/script/`);

  return (
    <div className={styles.root} data-script-root>
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
