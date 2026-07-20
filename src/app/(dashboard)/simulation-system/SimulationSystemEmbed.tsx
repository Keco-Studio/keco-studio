'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useSidebarProjects } from '@/components/layout/hooks/useSidebarProjects';
import {
  getSimulationOrigin,
  isSimulationEmbedConfigured,
  isSimulationOriginSameAsCurrent,
} from '@/lib/simulationClientConfig';
import { buildSimulationEmbedSrc } from '@/lib/simulationEmbedSrc';
import { readSimulationProjectHandoff } from '@/lib/simulationProjectHandoff';
import styles from './SimulationSystemEmbed.module.css';

export function SimulationSystemEmbed() {
  const configured = isSimulationEmbedConfigured();
  const origin = getSimulationOrigin();
  const { userProfile } = useAuth();
  const { projects } = useSidebarProjects(userProfile?.id);
  const [handoff, setHandoff] = useState(() => readSimulationProjectHandoff());

  // The same-origin check needs `window`, so resolve it after mount to avoid a
  // hydration mismatch (SSR renders the iframe path; client may swap to fallback).
  const [selfEmbed, setSelfEmbed] = useState(false);
  useEffect(() => {
    setSelfEmbed(isSimulationOriginSameAsCurrent());
    setHandoff(readSimulationProjectHandoff());
  }, []);

  const embedContext = useMemo(() => {
    const projectOptions = projects.map((project) => ({
      id: project.id,
      name: project.name?.trim() || 'Untitled project',
    }));

    const activeProject =
      (handoff?.projectId
        ? projectOptions.find((project) => project.id === handoff.projectId)
        : null)
      ?? (handoff?.projectName
        ? projectOptions.find((project) => project.name === handoff.projectName)
        : null)
      ?? (projectOptions[0] ?? (handoff
        ? { id: handoff.projectId, name: handoff.projectName }
        : null));

    if (!activeProject) return { projects: projectOptions };

    return {
      projectId: activeProject.id,
      projectName: activeProject.name,
      projects: projectOptions.length ? projectOptions : [activeProject],
    };
  }, [handoff, projects]);

  const src = useMemo(() => {
    if (!configured || !origin) return '';
    return buildSimulationEmbedSrc(origin, embedContext);
  }, [configured, origin, embedContext]);

  if (!configured || !origin) {
    return (
      <div className={styles.fallback}>
        <p>Simulator embedding is not enabled. To run it locally alongside Keco (Keco :3000 + keco-simulation-demo :5173), configure the following in <code>.env.local</code>:</p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {`NEXT_PUBLIC_SIMULATION_ENABLED=true
NEXT_PUBLIC_SIMULATION_ORIGIN=http://localhost:5173`}
        </pre>
        <p>After saving, restart <code>next dev</code> and start <code>keco-simulation-demo</code> in the sibling directory (default port 5173).</p>
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
          Point <code>NEXT_PUBLIC_SIMULATION_ORIGIN</code> at a separately running keco-simulation-demo (locally defaults to
          <code> http://localhost:5173</code>), then save and restart <code>next dev</code>.
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
