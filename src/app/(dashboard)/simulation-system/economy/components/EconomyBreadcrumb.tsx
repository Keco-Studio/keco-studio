'use client';

import Link from 'next/link';
import { Breadcrumb } from 'antd';
import {
  HomeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

/**
 * 经济模拟系统面包屑
 */
export function EconomyBreadcrumb() {
  return (
    <Breadcrumb
      style={{ margin: '16px 24px' }}
      items={[
        { title: <Link href="/simulation-system"><HomeOutlined /> 模拟系统</Link> },
        { title: <span><ThunderboltOutlined /> 经济模拟系统</span> },
      ]}
    />
  );
}
