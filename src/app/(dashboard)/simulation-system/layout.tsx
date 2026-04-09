import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '模拟系统 / Simulation System - Keco Studio',
  description: '游戏模拟工具 - 经济系统模拟、战斗模拟',
};

/**
 * 模拟系统主布局
 * /simulation-system 下的所有页面共享此布局
 */
export default function SimulationSystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
