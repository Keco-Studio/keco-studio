'use client';

import Link from 'next/link';
import styles from '../Sidebar.module.css';

/**
 * Battle Simulator entry in the sidebar
 * Provides quick access to the battle simulator tool
 */
export function SidebarBattleSimulatorEntry() {
  return (
    <>
      <div className={styles.sectionTitle}>
        <span>Tools</span>
      </div>
      <Link
        href="/battle-simulator"
        className={`${styles.item} ${styles.itemInactive}`}
        title="Battle Simulator - PVE turn-based battle simulation and difficulty assessment"
        style={{ cursor: 'pointer', textDecoration: 'none' }}
      >
        <span style={{ fontSize: '18px', marginRight: '8px' }}>⚔️</span>
        <span className={styles.itemText}>Battle Simulator</span>
      </Link>
    </>
  );
}