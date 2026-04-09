'use client';

import Link from 'next/link';
import { Breadcrumb } from 'antd';
import {
  HomeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import styles from './BattleBreadcrumb.module.css';

/**
 * 战斗模拟面包屑
 */
export function BattleBreadcrumb() {
  return (
    <Breadcrumb
      className={styles.breadcrumb}
      items={[
        {
          title: (
            <span className={styles.breadcrumbLink}>
              <Link href="/simulation-system"><HomeOutlined /> 模拟系统</Link>
            </span>
          ),
        },
        {
          title: (
            <span className={styles.breadcrumbCurrent}>
              <ThunderboltOutlined /> 战斗模拟
            </span>
          ),
        },
      ]}
    />
  );
}
