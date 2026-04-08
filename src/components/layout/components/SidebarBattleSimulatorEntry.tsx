'use client';

import { useRouter } from 'next/navigation';
import styles from '../Sidebar.module.css';

/**
 * Battle Simulator entry in the sidebar
 * Provides quick access to the battle simulator tool
 */
export function SidebarBattleSimulatorEntry() {
  const router = useRouter();

  const handleClick = () => {
    router.push('/battle-simulator');
  };

  return (
    <>
      <div className={styles.sectionTitle}>
        <span>Tools</span>
      </div>
      <div
        className={`${styles.item} ${styles.itemInactive}`}
        onClick={handleClick}
        title="Battle Simulator - PVE turn-based battle simulation and difficulty assessment"
        style={{ cursor: 'pointer' }}
      >
        <span style={{ fontSize: '18px', marginRight: '8px' }}>⚔️</span>
        <span className={styles.itemText}>Battle Simulator</span>
      </div>
    </>
  );
}
