'use client';

import Link from 'next/link';
import { Breadcrumb } from 'antd';
import {
  HomeOutlined,
  UserOutlined,
  ShoppingOutlined,
  TrophyOutlined,
  BankOutlined,
  StarOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import styles from './EconomyBreadcrumb.module.css';

type BreadcrumbItem = {
  label: string;
  icon?: React.ReactNode;
  href?: string;
};

interface EconomyBreadcrumbProps {
  items: BreadcrumbItem[];
}

/** 模块图标映射 */
const MODULE_ICONS: Record<string, React.ReactNode> = {
  '/economy-simulator': <HomeOutlined />,
  '/economy-simulator/characters': <UserOutlined />,
  '/economy-simulator/equipment': <ShoppingOutlined />,
  '/economy-simulator/arena': <TrophyOutlined />,
  '/economy-simulator/levels': <BankOutlined />,
  '/economy-simulator/prestige': <StarOutlined />,
  '/economy-simulator/calculator': <ExperimentOutlined />,
};

/**
 * 经济模拟系统面包屑导航组件
 */
export function EconomyBreadcrumb({ items }: EconomyBreadcrumbProps) {
  const breadcrumbItems = items.map((item, index) => ({
    title: item.href ? (
      <span className={styles.breadcrumbLink}>
        {item.icon && <span className={styles.breadcrumbIcon}>{item.icon}</span>}
        <Link href={item.href}>{item.label}</Link>
      </span>
    ) : (
      <span className={styles.breadcrumbCurrent}>
        {item.icon && <span className={styles.breadcrumbIcon}>{item.icon}</span>}
        {item.label}
      </span>
    ),
  }));

  return (
    <div className={styles.container}>
      <Breadcrumb items={breadcrumbItems} />
    </div>
  );
}

/**
 * 获取模块的图标
 */
export function getModuleIcon(path: string): React.ReactNode {
  return MODULE_ICONS[path] || <HomeOutlined />;
}
