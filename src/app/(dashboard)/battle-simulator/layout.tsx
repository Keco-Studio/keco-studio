import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Battle Simulator - Keco Studio',
  description: 'PVE turn-based battle simulation and difficulty assessment tool',
};

export default function BattleSimulatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
