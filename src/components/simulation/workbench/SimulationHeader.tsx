import type { ChangeEvent } from 'react';

import styles from './SimulationWorkbench.module.css';

export interface SimulationWorkflowStep {
  readonly id: string;
  readonly label: string;
  readonly complete?: boolean;
  readonly disabled?: boolean;
}

export interface SimulationHeaderProps {
  readonly title: string;
  readonly eyebrow?: string;
  readonly steps: readonly SimulationWorkflowStep[];
  readonly activeStepId: string;
  readonly searchValue?: string;
  readonly onSearchChange?: (value: string) => void;
  readonly onStepSelect?: (id: string) => void;
}

export function SimulationHeader({
  title,
  eyebrow = 'Simulation workspace',
  steps,
  activeStepId,
  searchValue = '',
  onSearchChange,
  onStepSelect,
}: SimulationHeaderProps) {
  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => onSearchChange?.(event.target.value);

  return (
    <header className={styles.header}>
      <div className={styles.headerTitle}>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
      </div>

      <nav className={styles.workflowNav} aria-label="Simulation workflow">
        <ol className={styles.workflowList}>
          {steps.map((step, index) => {
            const active = step.id === activeStepId;
            return (
              <li key={step.id} className={styles.workflowItem}>
                <button
                  type="button"
                  className={`${styles.workflowButton} ${active ? styles.workflowButtonActive : ''}`}
                  aria-current={active ? 'step' : undefined}
                  disabled={step.disabled}
                  onClick={() => onStepSelect?.(step.id)}
                >
                  <span className={styles.workflowNumber} aria-hidden="true">
                    {step.complete ? '✓' : index + 1}
                  </span>
                  <span>{step.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <label className={styles.search}>
        <span className={styles.searchIcon} aria-hidden="true" />
        <span className={styles.visuallyHidden}>Search simulator</span>
        <input
          type="search"
          value={searchValue}
          placeholder="Search roster"
          onChange={handleSearch}
        />
      </label>
    </header>
  );
}
