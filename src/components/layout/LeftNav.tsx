'use client';

import { type ReactNode, useEffect, useId, useState } from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  getProductNavigationDestination,
  getProductNavigationState,
  resolveActiveProductProjectId,
} from '@/lib/create-map/productNavigation';
import { readScriptProjectPreference, writeScriptProjectPreference } from '@/lib/script-system/projectPreference';
import { readStudioNavigationPreference, writeStudioProjectPreference } from '@/lib/studio/navigationPreference';
import {
  readLeftNavCollapsed,
  writeLeftNavCollapsed,
} from './leftNavStorage';
import { IconSpeechBubble } from './navIcons';
import {
  readSimulationProjectPreference,
  writeSimulationProjectPreference,
} from '@/lib/simulation/projectPreference';
import {
  readCreateMapProjectPreference,
  writeCreateMapProjectPreference,
} from '@/lib/create-map/projectPreference';
import archiveIcon from '@/assets/images/simulator/archive.svg';
import archiveActiveIcon from '@/assets/images/simulator/archive-active.svg';
import lightningIcon from '@/assets/images/simulator/ilightning.svg';
import lightningActiveIcon from '@/assets/images/simulator/lightning-active.svg';
import mapPlanIcon from '@/assets/images/simulator/map-plan.svg';
import mapPlanActiveIcon from '@/assets/images/simulator/map-plan-active.svg';
import botIcon from '@/assets/images/bot.svg';
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

function IconMap({ active }: { active: boolean }) {
  return (
    <Image
      src={active ? mapPlanActiveIcon : mapPlanIcon}
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

function IconDesign() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path
        d="M4.2 14.2 13 5.4l1.6 1.6-8.8 8.8H4.2v-1.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m11.8 6.6 1.6 1.6M12.9 5.5l1-1a1.1 1.1 0 0 1 1.6 0l.1.1a1.1 1.1 0 0 1 0 1.6l-1 1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDisclosure({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`${styles.disclosure} ${expanded ? styles.disclosureExpanded : ''}`}
      width="8"
      height="8"
      viewBox="0 0 8 8"
      aria-hidden
    >
      <path
        d="m2.5 1.5 3 2.5-3 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
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

type DesignSectionProps = {
  active: boolean;
  children: ReactNode;
};

function DesignSection({ active, children }: DesignSectionProps) {
  const [expanded, setExpanded] = useState(active);
  const toolsId = useId();

  return (
    <>
      <button
        type="button"
        className={`${styles.item} ${styles.designToggle} ${active ? styles.itemActive : ''}`}
        aria-label="Design"
        aria-expanded={expanded}
        aria-controls={expanded ? toolsId : undefined}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className={`${styles.iconWrap} ${styles.designIconWrap}`}>
          <IconDesign />
          <IconDisclosure expanded={expanded} />
        </span>
        <span className={styles.label}>Design</span>
      </button>
      {expanded ? (
        <div
          id={toolsId}
          className={styles.designGroup}
          role="group"
          aria-label="Design tools"
        >
          {children}
        </div>
      ) : null}
    </>
  );
}

type LeftNavProps = {
  userId?: string;
  assistantAvailable?: boolean;
  assistantOpen?: boolean;
  onAssistantToggle?: () => void;
};

export function LeftNav({ userId, assistantAvailable = false, assistantOpen = false, onAssistantToggle }: LeftNavProps) {
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
  const designActive = onSimulation || onScript || onCreateMap || onGameDesignSystem;

  const navigate = (
    item: 'studio' | 'simulation' | 'script' | 'createMap' | 'gameDesignSystem' | 'keco101',
  ) => {
    const studioPreference = readStudioNavigationPreference(userId);
    const scriptPreference = readScriptProjectPreference();
    const simulationPreference = readSimulationProjectPreference();
    const createMapPreference = readCreateMapProjectPreference();
    const preferenceBundle = {
      scriptProjectId: scriptPreference?.projectId,
      simulationProjectId: simulationPreference?.projectId,
      studioProjectId: studioPreference?.projectId,
      studioFileHref: studioPreference?.fileHref,
      createMapProjectId: createMapPreference?.projectId,
    };
    const activeProjectId = resolveActiveProductProjectId(pathname, preferenceBundle);
    const activeProjectName =
      (onScript
        ? scriptPreference?.projectName
        : onSimulation
          ? simulationPreference?.projectName
          : onCreateMap
            ? createMapPreference?.projectName
            : undefined) || 'Project';

    // Keep the open project when switching LeftNav products.
    if (activeProjectId) {
      if (item === 'script') {
        writeScriptProjectPreference({
          projectId: activeProjectId,
          projectName: activeProjectName,
        });
      }
      if (item === 'simulation') {
        writeSimulationProjectPreference({
          projectId: activeProjectId,
          projectName: activeProjectName,
        });
      }
      if (item === 'studio' && userId) {
        writeStudioProjectPreference(userId, activeProjectId);
      }
      if (item === 'createMap') {
        writeCreateMapProjectPreference({
          projectId: activeProjectId,
          projectName: activeProjectName,
        });
      }
    }

    const destination = getProductNavigationDestination(pathname, item, {
      ...preferenceBundle,
      activeProjectId,
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
          aria-label="Library"
          aria-current={onStudio ? 'page' : undefined}
          onClick={() => navigate('studio')}
        >
          <span className={styles.iconWrap}>
            <IconGrid active={onStudio} />
          </span>
          <span className={styles.label}>Library</span>
        </button>
        <DesignSection key={pathname} active={designActive}>
          <button
            type="button"
            className={`${styles.item} ${styles.designItem} ${onSimulation ? styles.itemActive : ''}`}
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
            className={`${styles.item} ${styles.designItem} ${onScript ? styles.itemActive : ''}`}
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
            className={`${styles.item} ${styles.designItem} ${onCreateMap ? styles.itemActive : ''}`}
            aria-label="Map"
            aria-current={onCreateMap ? 'page' : undefined}
            onClick={() => navigate('createMap')}
          >
            <span className={styles.iconWrap}>
              <IconMap active={onCreateMap} />
            </span>
            <span className={styles.label}>Map</span>
          </button>
          <button
            type="button"
            className={`${styles.item} ${styles.designItem} ${onGameDesignSystem ? styles.itemActive : ''}`}
            aria-label="System"
            aria-current={onGameDesignSystem ? 'page' : undefined}
            onClick={() => navigate('gameDesignSystem')}
          >
            <span className={styles.iconWrap}>
              <IconArchive active={onGameDesignSystem} />
            </span>
            <span className={styles.label}>System</span>
          </button>
        </DesignSection>
      </div>
      <div className={styles.footer}>
        {assistantAvailable && (
          <button
            type="button"
            className={`${styles.item} ${assistantOpen ? styles.itemActive : ''}`}
            aria-label="Keco Assistant"
            aria-pressed={assistantOpen}
            data-testid="agent-launcher"
            title="Keco Assistant"
            onClick={onAssistantToggle}
          >
            <span className={`${styles.iconWrap} ${styles.assistantIconWrap}`}>
              <Image src={botIcon} alt="" width={32} height={32} aria-hidden="true" />
            </span>
            <span className={styles.label}>AI</span>
          </button>
        )}
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
