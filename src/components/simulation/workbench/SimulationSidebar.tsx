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
  if (collapsed) {
    return <button type="button" className={styles.sidebarExpand} aria-label="Expand simulation sidebar" aria-expanded="false" onClick={onToggleCollapsed}>≫</button>;
  }

  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''} ${mobileOpen ? styles.sidebarMobileOpen : ''}`}
      aria-label="Simulation workspace"
    >
      <div className={styles.sidebarBrand}>
        <strong className={styles.brandText}>Keco Simulator</strong>
        <p>Battle &amp; numbers sandbox for game designers.</p>
      </div>

      <div className={styles.projectContext}>
        <label className={styles.visuallyHidden} htmlFor="simulation-project">Project</label>
        <select id="simulation-project" title="Project" value={projectId ?? ''} onChange={(event) => onProjectSelect?.(event.target.value)}>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <span aria-hidden="true">⌄</span>
      </div>

      <nav className={styles.sidebarNav} aria-label="Simulation screens">
        <div className={styles.sidebarMenu} role="menu">
          {items.map((item) => {
            const active = item.id === activeId;
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
                <span className={styles.sidebarIndex} aria-hidden="true">{item.id === 'import' ? '⇩' : 'ϟ'}</span>
                <span className={styles.sidebarItemCopy}>
                  <strong>{item.label}</strong>
                  {item.description && item.id !== 'import' ? <small>{item.description}</small> : null}
                </span>
                {item.badge ? <span className={styles.sidebarBadge}>{item.badge}</span> : null}
              </button>
            );
          })}
        </div>
      </nav>

      <button type="button" className={styles.collapseButton} aria-label="Collapse simulation sidebar" aria-expanded="true" onClick={onToggleCollapsed}>≪</button>
    </aside>
  );
}
