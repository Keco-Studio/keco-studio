'use client';

import Link from 'next/link';
import styles from '../Sidebar.module.css';

/**
 * 经济模拟系统入口 - Sidebar Entry
 * 在侧边栏提供快速访问经济模拟工具的入口
 */
export function SidebarEconomySimulatorEntry() {
  return (
    <>
      <div className={styles.sectionTitle}>
        <span>工具 / Tools</span>
      </div>
      <Link
        href="/economy-simulator"
        className={`${styles.item} ${styles.itemInactive}`}
        title="经济模拟系统 - 角色养成、装备系统、竞技场、关卡收益计算"
        style={{ cursor: 'pointer', textDecoration: 'none' }}
      >
        <span style={{ fontSize: '18px', marginRight: '8px' }}>💰</span>
        <span className={styles.itemText}>经济模拟系统</span>
      </Link>
    </>
  );
}