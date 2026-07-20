'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  readLeftNavCollapsed,
  writeLeftNavCollapsed,
} from './leftNavStorage';
import styles from './LeftNav.module.css';

function isSimulationPath(pathname: string | null): boolean {
  return (pathname ?? '').startsWith('/simulation-system');
}

function IconGrid({ active }: { active: boolean }) {
  const stroke = active ? 'currentColor' : '#111';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <rect x="1" y="1" width="6" height="6" rx="1" fill="none" stroke={stroke} strokeWidth="1.5" />
      <rect x="11" y="1" width="6" height="6" rx="1" fill="none" stroke={stroke} strokeWidth="1.5" />
      <rect x="1" y="11" width="6" height="6" rx="1" fill="none" stroke={stroke} strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1" fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

function IconBolt({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        d="M10 1L4 10h5l-1 7 6-9h-5l1-7z"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconList() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        d="M3 4.5h12M3 9h9M3 13.5h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBox() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        d="M3 7h12v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7zM3 7l1.5-3.5h9L15 7M7 10.5h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCollapse() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M9.5 4L6 8l3.5 4M12.5 4L9 8l3.5 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconExpand() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M6.5 4L10 8l-3.5 4M3.5 4L7 8l-3.5 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LeftNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const onSimulation = isSimulationPath(pathname);

  useEffect(() => {
    setCollapsed(readLeftNavCollapsed());
    setReady(true);
  }, []);

  const setCollapsedPersist = (next: boolean) => {
    setCollapsed(next);
    writeLeftNavCollapsed(next);
  };

  if (ready && collapsed) {
    return (
      <button
        type="button"
        className={styles.expandTab}
        aria-label="Expand navigation"
        onClick={() => setCollapsedPersist(false)}
      >
        <IconExpand />
      </button>
    );
  }

  return (
    <nav className={styles.rail} aria-label="Product">
      <div className={styles.brand} aria-hidden>
        K
      </div>
      <div className={styles.items}>
        <button
          type="button"
          className={`${styles.item} ${!onSimulation ? styles.itemActive : ''}`}
          aria-label="Studio"
          aria-current={!onSimulation ? 'page' : undefined}
          onClick={() => {
            if (onSimulation) router.push('/projects');
          }}
        >
          <IconGrid active={!onSimulation} />
        </button>
        <button
          type="button"
          className={`${styles.item} ${onSimulation ? styles.itemActive : ''}`}
          aria-label="Simulation"
          aria-current={onSimulation ? 'page' : undefined}
          onClick={() => {
            if (!onSimulation) router.push('/simulation-system');
          }}
        >
          <IconBolt active={onSimulation} />
        </button>
        <button
          type="button"
          className={`${styles.item} ${styles.itemDisabled}`}
          aria-label="Coming soon"
          aria-disabled="true"
          tabIndex={-1}
        >
          <IconList />
        </button>
        <button
          type="button"
          className={`${styles.item} ${styles.itemDisabled}`}
          aria-label="Coming soon"
          aria-disabled="true"
          tabIndex={-1}
        >
          <IconBox />
        </button>
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.item}
          aria-label="Collapse navigation"
          onClick={() => setCollapsedPersist(true)}
        >
          <IconCollapse />
        </button>
      </div>
    </nav>
  );
}
