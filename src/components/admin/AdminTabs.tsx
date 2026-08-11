'use client';

import { usePathname, useRouter } from 'next/navigation';
import styles from './AdminPage.module.css';

type AdminTabsProps = {
  projectId: string;
  /** When false, Collaborator tab is hidden (users who cannot invite). */
  canManageCollaborators?: boolean;
};

export function AdminTabs({ projectId, canManageCollaborators = true }: AdminTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const onCollaborators = (pathname ?? '').startsWith(`/${projectId}/admin/collaborators`);

  return (
    <div className={styles.tabs} role="tablist" aria-label="Settings sections">
      <button
        type="button"
        role="tab"
        aria-selected={!onCollaborators}
        className={`${styles.tab} ${!onCollaborators ? styles.tabActive : ''}`}
        data-testid="admin-tab-settings"
        onClick={() => router.push(`/${projectId}/admin`)}
      >
        General
      </button>
      {canManageCollaborators ? (
        <button
          type="button"
          role="tab"
          aria-selected={onCollaborators}
          className={`${styles.tab} ${onCollaborators ? styles.tabActive : ''}`}
          data-testid="admin-tab-collaborator"
          onClick={() => router.push(`/${projectId}/admin/collaborators`)}
        >
          Collaborator
        </button>
      ) : null}
    </div>
  );
}
