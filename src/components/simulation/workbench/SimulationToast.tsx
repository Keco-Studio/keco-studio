import styles from './SimulationWorkbench.module.css';

export interface SimulationToastProps {
  readonly message: string;
  readonly tone?: 'success' | 'info' | 'warning' | 'error';
  readonly visible?: boolean;
  readonly onDismiss?: () => void;
}

export function SimulationToast({
  message,
  tone = 'info',
  visible = true,
  onDismiss,
}: SimulationToastProps) {
  if (!visible || !message) return null;

  return (
    <div
      className={`${styles.toast} ${styles[`toast_${tone}`]}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={styles.toastIndicator} aria-hidden="true" />
      <span className={styles.toastMessage}>{message}</span>
      {onDismiss ? (
        <button type="button" className={styles.toastDismiss} aria-label="Dismiss notification" onClick={onDismiss}>
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}
