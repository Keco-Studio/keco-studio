import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '战斗模拟器 - Keco Studio',
  description: 'PVE 回合制战斗模拟和难度评估工具',
};

export default function BattleSimulatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
