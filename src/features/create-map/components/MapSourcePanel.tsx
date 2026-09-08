'use client';

import { useEffect, useRef, useState } from 'react';
import { writeCreateMapProjectPreference } from '@/lib/create-map/projectPreference';
import styles from '../CreateMapWorkbench.module.css';

export type MapSourceOption = { id: string; name: string };

type MapSourcePanelProps = {
  versionLabel?: 'V2' | 'V3';
  readOnly?: boolean;
  projects: MapSourceOption[];
  projectId: string;
  onProjectChange: (id: string) => void;
  busy?: boolean;
  error?: string | null;
};

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function MapSourcePanel({
  readOnly = false,
  projects,
  projectId,
  onProjectChange,
  busy = false,
  error = null,
}: MapSourcePanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = projects.find((project) => project.id === projectId) ?? null;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!selected) return;
    writeCreateMapProjectPreference({ projectId: selected.id, projectName: selected.name });
  }, [selected]);

  return (
    <section className={styles.brandSection} aria-labelledby="map-source-heading">
      <div className={styles.brandBlock}>
        <h1 id="map-source-heading" className={styles.brandTitle}>Map Generator</h1>
        <p className={styles.brandSubtitle}>Manage and config game assets for game designers.</p>
      </div>

      <div className={styles.projectWrap} ref={menuRef}>
        <button
          type="button"
          className={styles.projectButton}
          aria-label="Project"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          disabled={busy || readOnly}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className={styles.projectName}>{selected?.name ?? 'Select project'}</span>
          <span className={styles.projectChevron}><ChevronDownIcon /></span>
        </button>
        {menuOpen ? (
          <div className={styles.projectMenu} role="listbox" aria-label="Projects">
            {projects.length === 0 ? (
              <div className={styles.projectEmpty}>No projects</div>
            ) : (
              <div className={styles.projectOptions}>
                {projects.map((project) => {
                  const selected = project.id === projectId;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`${styles.projectOption} ${
                        selected ? styles.projectOptionSelected : ''
                      }`}
                      onClick={() => {
                        onProjectChange(project.id);
                        setMenuOpen(false);
                      }}
                    >
                      <span className={styles.projectOptionText}>{project.name}</span>
                      <span className={styles.projectOptionCheck} aria-hidden="true">
                        {selected ? <CheckIcon /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
      {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
    </section>
  );
}
