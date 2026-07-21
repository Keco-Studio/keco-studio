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
  readonly collapsed?: boolean;
  readonly mobileOpen?: boolean;
  readonly onSelect: (id: string) => void;
  readonly onToggleCollapsed: () => void;
  readonly onCloseMobile?: () => void;
}

export function SimulationSidebar({
  items,
  activeId,
  projectName = 'Untitled project',
  collapsed = false,
  mobileOpen = false,
  onSelect,
  onToggleCollapsed,
  onCloseMobile,
}: SimulationSidebarProps) {
  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''} ${mobileOpen ? styles.sidebarMobileOpen : ''}`}
      aria-label="Simulation workspace"
    >
      <div className={styles.sidebarBrand}>
        <span className={styles.brandMark} aria-hidden="true">KS</span>
        <span className={styles.brandText}>Keco Simulator</span>
        <button
          type="button"
          className={styles.collapseButton}
          aria-label={collapsed ? 'Expand simulation sidebar' : 'Collapse simulation sidebar'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
        </button>
      </div>

      <div className={styles.projectContext}>
        <span className={styles.contextLabel}>Project</span>
        <strong title={projectName}>{projectName}</strong>
      </div>

      <nav className={styles.sidebarNav} aria-label="Simulation screens">
        <div className={styles.sidebarMenu} role="menu">
          {items.map((item, index) => {
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
                <span className={styles.sidebarIndex} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.sidebarItemCopy}>
                  <strong>{item.label}</strong>
                  {item.description ? <small>{item.description}</small> : null}
                </span>
                {item.badge ? <span className={styles.sidebarBadge}>{item.badge}</span> : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className={styles.sidebarFooter}>
        <span className={styles.connectionDot} aria-hidden="true" />
        <span>Studio data ready</span>
      </div>
    </aside>
  );
}
