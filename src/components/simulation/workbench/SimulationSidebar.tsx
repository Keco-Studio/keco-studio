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
  readonly onToggleCollapsed: () => void;
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
  onToggleCollapsed,
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

  if (collapsed) {
    return (
      <button
        type="button"
        className={styles.sidebarExpand}
        aria-label="Expand simulation sidebar"
        aria-expanded="false"
        title="Expand sidebar"
        onClick={onToggleCollapsed}
      >
        ≫
      </button>
    );
  }

  return (
    <aside
      className={`${styles.sidebar} ${mobileOpen ? styles.sidebarMobileOpen : ''}`}
      aria-label="Simulation workspace"
      style={{ backdropFilter: 'var(--blur-glass)' }}
    >
      <div className={styles.sidebarBrand}>
        <strong className={styles.brandText}>Keco Siumlator</strong>
        <p>Battle &amp; numbers sandbox for game designers.</p>
      </div>

      <div ref={projectMenuRef} style={{ position: 'relative' }}>
        <button
          type="button"
          title="Project"
          onClick={() => setProjectMenuOpen((value) => !value)}
          style={{
            margin: '12px 6px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: 'calc(100% - 12px)',
            padding: 0,
            border: 'none',
            background: 'transparent',
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--ink-800)',
            cursor: 'pointer',
            fontFamily: 'var(--font-roboto)',
            lineHeight: 1,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
            {projectName || 'Project'}
          </span>
          <span style={{ color: 'var(--ink-400)', display: 'inline-flex' }}><ChevronDownIcon /></span>
        </button>
        {projectMenuOpen && projects.length > 0 ? (
          <div style={{
            position: 'absolute',
            zIndex: 50,
            left: 6,
            right: 6,
            top: 'calc(100% + 4px)',
            background: '#fff',
            border: '1px solid var(--line-200)',
            borderRadius: 10,
            boxShadow: 'var(--shadow-popover)',
            padding: 4,
            maxHeight: 220,
            overflowY: 'auto',
          }}
          >
            {projects.map((project) => {
              const selected = project.id === projectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    onProjectSelect?.(project.id);
                    setProjectMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    border: 'none',
                    background: selected ? 'var(--keco-blue-tint)' : 'transparent',
                    color: selected ? 'var(--keco-blue)' : 'var(--ink-700)',
                    borderRadius: 8,
                    height: 34,
                    padding: '0 10px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: selected ? 600 : 500,
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

      <button
        type="button"
        className={styles.collapseButton}
        aria-label="Collapse simulation sidebar"
        aria-expanded="true"
        title="Collapse sidebar"
        onClick={onToggleCollapsed}
      >
        ≪
      </button>
    </aside>
  );
}
