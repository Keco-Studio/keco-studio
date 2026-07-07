'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  getSimulationOrigin,
  isSimulationEmbedConfigured,
  isSimulationOriginSameAsCurrent,
} from '@/lib/simulationClientConfig';
import styles from './SimulationSystemEmbed.module.css';

export function SimulationSystemEmbed() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const configured = isSimulationEmbedConfigured();
  const origin = getSimulationOrigin();

  // The same-origin check needs `window`, so resolve it after mount to avoid a
  // hydration mismatch (SSR renders the iframe path; client may swap to fallback).
  const [selfEmbed, setSelfEmbed] = useState(false);
  useEffect(() => {
    setSelfEmbed(isSimulationOriginSameAsCurrent());
  }, []);

  const src = useMemo(() => {
    if (!configured || !origin) return '';
    const qs = searchParams.toString();
    const suffix = qs ? `?${qs}` : '';
    return `${origin}${pathname}${suffix}`;
  }, [configured, origin, pathname, searchParams]);

  if (!configured || !origin) {
    return (
      <div className={styles.fallback}>
        <p>Simulator embedding is not enabled. To run it locally alongside Keco (Keco :3000 + keco-simulation :3001), configure the following in <code>.env.local</code>:</p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {`NEXT_PUBLIC_SIMULATION_ENABLED=true
NEXT_PUBLIC_SIMULATION_ORIGIN=http://localhost:3001`}
        </pre>
        <p>After saving, restart <code>next dev</code> and start <code>keco-simulation</code> in the sibling directory (default port 3001).</p>
      </div>
    );
  }

  // Guard against recursive self-embedding: if the simulation origin is the same
  // as Studio's own origin, the iframe would load this very page again and again,
  // freezing the browser. Refuse to render the iframe and explain the misconfig.
  if (selfEmbed) {
    return (
      <div className={styles.fallback}>
        <p>
          Detected that <code>NEXT_PUBLIC_SIMULATION_ORIGIN</code> is the same as the current Keco Studio origin (
          <code>{origin}</code>). This would make the simulator iframe repeatedly load Studio itself and freeze the page, so embedding has been stopped.
        </p>
        <p>
          Point <code>NEXT_PUBLIC_SIMULATION_ORIGIN</code> at a separately running keco-simulation (locally defaults to
          <code> http://localhost:3001</code>), then save and restart <code>next dev</code>.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <iframe className={styles.frame} title="Simulation system" src={src} />
    </div>
  );
}
