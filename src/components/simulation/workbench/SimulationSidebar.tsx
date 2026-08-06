import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import importIcon from '@/assets/images/simulator/import.svg';
import lightningIcon from '@/assets/images/simulator/ilightning.svg';
import styles from './SimulationWorkbench.module.css';

export interface SimulationSidebarItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly badge?: string;
}

export interface SimulationSidebarProps {
  readonly items: readonly SimulationSidebarItem[];
  readonly activeId: string;
  readonly projectName?: string;
  readonly projects?: readonly { readonly id: string; readonly name: string }[];
  readonly projectId?: string | null;
  readonly collapsed?: boolean;
  readonly mobileOpen?: boolean;
  readonly onSelect: (id: string) => void;
  readonly onProjectSelect?: (projectId: string) => void;
  readonly onCloseMobile?: () => void;
}

function ImportIcon() {
  return <Image src={importIcon} alt="" width={18} height={18} aria-hidden="true" />;
}

function BoltIcon({ size = 18 }: { size?: number }) {
  return <Image src={lightningIcon} alt="" width={size} height={size} aria-hidden="true" />;
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function SimulationSidebar({
  items,
  activeId,
  projectName = 'Untitled project',
  projects = [],
  projectId = null,
  collapsed = false,
  mobileOpen = false,
  onSelect,
  onProjectSelect,
  onCloseMobile,
}: SimulationSidebarProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!projectMenuOpen) return;
    function onDocMouseDown(event: MouseEvent) {
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) {
        setProjectMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [projectMenuOpen]);

  return (
    <aside
      className={[
        styles.sidebar,
        collapsed ? styles.sidebarHidden : '',
        mobileOpen ? styles.sidebarMobileOpen : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Simulation workspace"
      aria-hidden={collapsed}
      style={{ backdropFilter: 'var(--blur-glass)' }}
    >
      <div className={styles.sidebarBrand}>
        <strong className={styles.brandText}>Keco Siumlator</strong>
        <p>Battle &amp; numbers sandbox · for game designers</p>
      </div>

      <div ref={projectMenuRef} className={styles.projectWrap}>
        <button
          type="button"
          className={styles.projectButton}
          title="Project"
          aria-haspopup="listbox"
          aria-expanded={projectMenuOpen}
          onClick={() => setProjectMenuOpen((value) => !value)}
        >
          <span className={styles.projectName}>{projectName || 'Project'}</span>
          <span className={styles.projectChevron}>
            <ChevronDownIcon />
          </span>
        </button>
        {projectMenuOpen && projects.length > 0 ? (
          <div className={styles.projectMenu} role="listbox" aria-label="Projects">
            {projects.map((project) => {
              const selected = project.id === projectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`${styles.projectOption} ${
                    selected ? styles.projectOptionSelected : ''
                  }`}
                  onClick={() => {
                    onProjectSelect?.(project.id);
                    setProjectMenuOpen(false);
                  }}
                >
                  {project.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <nav className={styles.sidebarNav} aria-label="Simulation screens">
        <div className={styles.sidebarMenu} role="menu">
          {items.map((item) => {
            const active = item.id === activeId;
            const isImport = item.id === 'import';
            return (
              <button
                type="button"
                role="menuitem"
                key={item.id}
                className={`${styles.sidebarItem} ${active ? styles.sidebarItemActive : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  onSelect(item.id);
                  onCloseMobile?.();
                }}
              >
                <span className={styles.sidebarIndex} aria-hidden="true">
                  {isImport ? <ImportIcon /> : <BoltIcon />}
                </span>
                <span className={styles.sidebarItemCopy}>
                  <strong>{item.label}</strong>
                </span>
                {item.badge ? <span className={styles.sidebarBadge}>{item.badge}</span> : null}
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
