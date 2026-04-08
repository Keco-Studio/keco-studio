import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '经济模拟系统 / Economy Simulator - Keco Studio',
  description: '游戏经济系统模拟工具 - 角色成长、装备系统、竞技场、关卡收益计算',
};

/**
 * 经济模拟系统主布局
 * /economy-simulator 下的所有页面共享此布局
 */
export default function EconomySimulatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
