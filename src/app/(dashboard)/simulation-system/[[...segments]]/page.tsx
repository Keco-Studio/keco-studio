import { Suspense } from 'react';
import { SimulationWorkbenchPage } from '../SimulationWorkbenchPage';

export default function SimulationSystemPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Loading simulator…</div>}>
      <SimulationWorkbenchPage />
    </Suspense>
  );
}
