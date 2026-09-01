'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  getProductNavigationDestination,
  getProductNavigationState,
} from '@/lib/create-map/productNavigation';
import { readScriptProjectPreference } from '@/lib/script-system/projectPreference';
import { readStudioNavigationPreference } from '@/lib/studio/navigationPreference';
import {
  readLeftNavCollapsed,
  writeLeftNavCollapsed,
} from './leftNavStorage';
import { readSimulationProjectPreference } from '@/lib/simulation/projectPreference';
import alignCenterIcon from '@/assets/images/simulator/align-center.svg';
import alignCenterActiveIcon from '@/assets/images/simulator/align-center-active.svg';
import archiveIcon from '@/assets/images/simulator/archive.svg';
import archiveActiveIcon from '@/assets/images/simulator/archive-active.svg';
import lightningIcon from '@/assets/images/simulator/ilightning.svg';
import lightningActiveIcon from '@/assets/images/simulator/lightning-active.svg';
import styles from './LeftNav.module.css';

function IconGrid({ active }: { active: boolean }) {
  const stroke = active ? 'currentColor' : '#111';
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <rect x="1.5" y="1.5" width="6.5" height="6.5" rx="1" fill="none" stroke={stroke} strokeWidth="1.5" />
      <rect x="12" y="1.5" width="6.5" height="6.5" rx="1" fill="none" stroke={stroke} strokeWidth="1.5" />
      <rect x="1.5" y="12" width="6.5" height="6.5" rx="1" fill="none" stroke={stroke} strokeWidth="1.5" />
      <rect x="12" y="12" width="6.5" height="6.5" rx="1" fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

function IconBolt({ active }: { active: boolean }) {
  return (
    <Image
      src={active ? lightningActiveIcon : lightningIcon}
      alt=""
      width={20}
      height={20}
      aria-hidden="true"
    />
  );
}

function IconSpeechBubble({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path
        d="M3.5 5a1.5 1.5 0 0 1 1.5-1.5h10A1.5 1.5 0 0 1 16.5 5v5.5a1.5 1.5 0 0 1-1.5 1.5H8.5L5 16.5V12H5A1.5 1.5 0 0 1 3.5 10.5V5z"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconAlign({ active }: { active: boolean }) {
  return (
    <Image
      src={active ? alignCenterActiveIcon : alignCenterIcon}
      alt=""
      width={20}
      height={20}
      aria-hidden="true"
    />
  );
}

function IconArchive({ active }: { active: boolean }) {
  return (
    <Image
      src={active ? archiveActiveIcon : archiveIcon}
      alt=""
      width={20}
      height={20}
      aria-hidden="true"
    />
  );
}

function IconBook({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path
        d="M10 5.8C8.6 4.6 6.7 3.9 4.7 3.9H2.8v10.9h1.9c2 0 3.9.7 5.3 1.9"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 5.8c1.4-1.2 3.3-1.9 5.3-1.9h1.9v10.9h-1.9c-2 0-3.9.7-5.3 1.9V5.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
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

export function LeftNav({ userId }: { userId?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const navigationState = getProductNavigationState(pathname);
  const {
    studio: onStudio,
    simulation: onSimulation,
    script: onScript,
    createMap: onCreateMap,
    gameDesignSystem: onGameDesignSystem,
    keco101: onKeco101,
  } = navigationState;

  const navigate = (
    item: 'studio' | 'simulation' | 'script' | 'createMap' | 'gameDesignSystem' | 'keco101',
  ) => {
    const studioPreference = readStudioNavigationPreference(userId);
    const destination = getProductNavigationDestination(pathname, item, {
      scriptProjectId: onScript || item === 'script' ? readScriptProjectPreference()?.projectId : undefined,
      simulationProjectId: onSimulation ? readSimulationProjectPreference()?.projectId : undefined,
      studioProjectId: studioPreference?.projectId,
      studioFileHref: studioPreference?.fileHref,
    });

    if (destination) router.push(destination);
  };

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
          className={`${styles.item} ${onKeco101 ? styles.itemActive : ''}`}
          aria-label="Keco 101"
          aria-current={onKeco101 ? 'page' : undefined}
          onClick={() => navigate('keco101')}
        >
          <span className={styles.iconWrap}>
            <IconBook active={onKeco101} />
          </span>
          <span className={styles.label}>101</span>
        </button>
        <button
          type="button"
          className={`${styles.item} ${onStudio ? styles.itemActive : ''}`}
          aria-label="Libraries"
          aria-current={onStudio ? 'page' : undefined}
          onClick={() => navigate('studio')}
        >
          <span className={styles.iconWrap}>
            <IconGrid active={onStudio} />
          </span>
          <span className={styles.label}>Libraries</span>
        </button>
        <button
          type="button"
          className={`${styles.item} ${onSimulation ? styles.itemActive : ''}`}
          aria-label="Simulator"
          aria-current={onSimulation ? 'page' : undefined}
          onClick={() => navigate('simulation')}
        >
          <span className={styles.iconWrap}>
            <IconBolt active={onSimulation} />
          </span>
          <span className={styles.label}>Simulator</span>
        </button>
        <button
          type="button"
          className={`${styles.item} ${onScript ? styles.itemActive : ''}`}
          aria-label="Script"
          aria-current={onScript ? 'page' : undefined}
          onClick={() => navigate('script')}
        >
          <span className={styles.iconWrap}>
            <IconSpeechBubble active={onScript} />
          </span>
          <span className={styles.label}>Script</span>
        </button>
        <button
          type="button"
          className={`${styles.item} ${onCreateMap ? styles.itemActive : ''}`}
          aria-label="Map"
          aria-current={onCreateMap ? 'page' : undefined}
          onClick={() => navigate('createMap')}
        >
          <span className={styles.iconWrap}>
            <IconAlign active={onCreateMap} />
          </span>
          <span className={styles.label}>Map</span>
        </button>
        <button
          type="button"
          className={`${styles.item} ${onGameDesignSystem ? styles.itemActive : ''}`}
          aria-label="System"
          aria-current={onGameDesignSystem ? 'page' : undefined}
          onClick={() => navigate('gameDesignSystem')}
        >
          <span className={styles.iconWrap}>
            <IconArchive active={onGameDesignSystem} />
          </span>
          <span className={styles.label}>System</span>
        </button>
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.collapseButton}
          aria-label="Collapse navigation"
          onClick={() => setCollapsedPersist(true)}
        >
          <IconCollapse />
        </button>
      </div>
    </nav>
  );
}
