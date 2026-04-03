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
        <span>工具</span>
      </div>
      <div
        className={`${styles.item} ${styles.itemInactive}`}
        onClick={handleClick}
        title="战斗模拟器 - PVE 回合制战斗模拟和难度评估"
        style={{ cursor: 'pointer' }}
      >
        <span style={{ fontSize: '18px', marginRight: '8px' }}>⚔️</span>
        <span className={styles.itemText}>战斗模拟器</span>
      </div>
    </>
  );
}
