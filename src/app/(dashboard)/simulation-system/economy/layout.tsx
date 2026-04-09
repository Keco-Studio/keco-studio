import type { Metadata } from 'next';
import { EconomyBreadcrumb } from './components/EconomyBreadcrumb';

export const metadata: Metadata = {
  title: '经济模拟系统 / Economy Simulator - Keco Studio',
  description: '游戏经济系统模拟工具 - 角色成长、装备系统、竞技场、关卡收益计算',
};

/**
 * 经济模拟系统布局
 * 添加面包屑导航
 */
export default function EconomyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <EconomyBreadcrumb />
      {children}
    </>
  );
}
