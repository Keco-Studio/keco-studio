import type { Metadata } from 'next';
import { BattleBreadcrumb } from './components/BattleBreadcrumb';

export const metadata: Metadata = {
  title: '战斗模拟 / Battle Simulator - Keco Studio',
  description: 'PVE回合制战斗模拟与难度评估工具',
};

/**
 * 战斗模拟布局
 * 添加面包屑导航
 */
export default function BattleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BattleBreadcrumb />
      {children}
    </>
  );
}
