import { Suspense } from 'react';
import { SimulationSystemEmbed } from '../SimulationSystemEmbed';

export default function SimulationSystemEmbedPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Loading simulator…</div>}>
      <SimulationSystemEmbed />
    </Suspense>
  );
}
