import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Simulation System - Keco Studio',
  description: 'Native Keco Studio battle simulation workspace',
};

export default function SimulationSystemLayout({ children }: { children: React.ReactNode }) {
  return children;
}
