'use client';

import { SimulationWorkbench } from '@/components/simulation/workbench/SimulationWorkbench';
import { SimulationProjectProvider } from '@/lib/simulation/SimulationProjectProvider';
import { SimulationSessionProvider } from '@/lib/simulation/SimulationSessionProvider';

export function SimulationWorkbenchPage() {
  return <SimulationProjectProvider><SimulationSessionProvider><SimulationWorkbench /></SimulationSessionProvider></SimulationProjectProvider>;
}
