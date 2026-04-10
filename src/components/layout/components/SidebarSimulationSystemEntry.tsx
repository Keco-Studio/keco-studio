'use client';

import Link from 'next/link';
import styles from '../Sidebar.module.css';

/**
 * 模拟系统入口 - Sidebar Entry
 * 在侧边栏提供快速访问模拟系统工具的入口
 * 整合了战斗模拟和经济模拟
 */
export function SidebarSimulationSystemEntry() {
  return (
    <>
      <Link
        href="/simulation-system"
        className={`${styles.item} ${styles.itemInactive}`}
        title="模拟系统 - 战斗模拟、经济模拟"
        style={{ cursor: 'pointer', textDecoration: 'none' }}
      >
        <span style={{ fontSize: '18px', marginRight: '8px' }}>🎮</span>
        <span className={styles.itemText}>模拟系统</span>
      </Link>
    </>
  );
}
