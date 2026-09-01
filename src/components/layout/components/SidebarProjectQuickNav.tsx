'use client';

import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import clockIcon from '@/assets/images/nav-icons/clock.svg';
import settingsIcon from '@/assets/images/nav-icons/settings-outline.svg';
import styles from '../Sidebar.module.css';

type SidebarProjectQuickNavProps = {
  projectId: string | null;
};

export function SidebarProjectQuickNav({ projectId }: SidebarProjectQuickNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  if (!projectId) return null;

  const onRecent = (pathname ?? '').startsWith(`/${projectId}/recent`);
  const onAdmin = (pathname ?? '').startsWith(`/${projectId}/admin`);

  return (
    <nav className={styles.projectQuickNav} aria-label="Project shortcuts">
      <button
        type="button"
        className={`${styles.projectQuickNavItem} ${onRecent ? styles.projectQuickNavItemActive : ''}`}
        aria-current={onRecent ? 'page' : undefined}
        data-testid="sidebar-recent-nav"
        onClick={() => router.push(`/${projectId}/recent`)}
      >
        <Image
          src={clockIcon}
          alt=""
          width={24}
          height={24}
          className={`icon-24 ${styles.projectQuickNavIcon}`}
          aria-hidden
        />
        <span>Recent</span>
      </button>
      <button
        type="button"
        className={`${styles.projectQuickNavItem} ${onAdmin ? styles.projectQuickNavItemActive : ''}`}
        aria-current={onAdmin ? 'page' : undefined}
        data-testid="sidebar-admin-nav"
        onClick={() => router.push(`/${projectId}/admin`)}
      >
        <Image
          src={settingsIcon}
          alt=""
          width={24}
          height={24}
          className={`icon-24 ${styles.projectQuickNavIcon}`}
          aria-hidden
        />
        <span>Settings</span>
      </button>
    </nav>
  );
}
