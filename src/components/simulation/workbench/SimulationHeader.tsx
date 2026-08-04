import styles from './SimulationWorkbench.module.css';

export interface SimulationWorkflowStep {
  readonly id: string;
  readonly label: string;
  readonly complete?: boolean;
  readonly disabled?: boolean;
}

export interface SimulationHeaderProps {
  readonly title: string;
  readonly projectName?: string;
  readonly steps: readonly SimulationWorkflowStep[];
  readonly activeStepId: string;
  readonly onStepSelect?: (id: string) => void;
}

export function SimulationHeader({
  title,
  projectName = 'Project',
  steps,
  activeStepId,
  onStepSelect,
}: SimulationHeaderProps) {
  const isImport = activeStepId === 'import';

  return (
    <header className={styles.header}>
      {isImport ? (
        <div className={styles.headerTitle}>
          <span>{projectName}</span>
          <i>/</i>
          <h1>{title}</h1>
        </div>
      ) : (
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
                      {index + 1}
                    </span>
                    <span>{step.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
    </header>
  );
}
