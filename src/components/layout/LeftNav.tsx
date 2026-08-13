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
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        d="M3 4.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 15 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14.5V11H4.5A1.5 1.5 0 0 1 3 9.5v-5z"
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
  const { studio: onStudio, simulation: onSimulation, script: onScript, createMap: onCreateMap } = navigationState;

  const navigate = (item: 'studio' | 'simulation' | 'script' | 'createMap') => {
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
          className={`${styles.item} ${onStudio ? styles.itemActive : ''}`}
          aria-label="Studio"
          aria-current={onStudio ? 'page' : undefined}
          onClick={() => navigate('studio')}
        >
          <IconGrid active={onStudio} />
        </button>
        <button
          type="button"
          className={`${styles.item} ${onSimulation ? styles.itemActive : ''}`}
          aria-label="Simulation"
          aria-current={onSimulation ? 'page' : undefined}
          onClick={() => navigate('simulation')}
        >
          <IconBolt active={onSimulation} />
        </button>
        <button
          type="button"
          className={`${styles.item} ${onScript ? styles.itemActive : ''}`}
          aria-label="Script"
          aria-current={onScript ? 'page' : undefined}
          onClick={() => navigate('script')}
        >
          <IconSpeechBubble active={onScript} />
        </button>
        <button
          type="button"
          className={`${styles.item} ${onCreateMap ? styles.itemActive : ''}`}
          aria-label="Create Map"
          aria-current={onCreateMap ? 'page' : undefined}
          onClick={() => navigate('createMap')}
        >
          <IconAlign active={onCreateMap} />
        </button>
        <button
          type="button"
          className={`${styles.item} ${styles.itemDisabled}`}
          aria-label="Coming soon"
          aria-disabled="true"
          tabIndex={-1}
        >
          <IconArchive active={false} />
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
