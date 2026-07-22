import styles from './SimulationWorkbench.module.css';

export interface SimulationToastProps {
  readonly message: string;
  readonly tone?: 'success' | 'info' | 'warning' | 'error';
  readonly visible?: boolean;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

export function SimulationToast({
  message,
  tone = 'info',
  visible = true,
  actionLabel,
  onAction,
}: SimulationToastProps) {
  if (!visible || !message) return null;

  return (
    <div className={`${styles.toast} ${styles[`toast_${tone}`]}`} role="status" aria-live="polite" aria-atomic="true">
      <span className={styles.toastIndicator} />
      <span className={styles.toastMessage}>{message}</span>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className={styles.toastAction}>{actionLabel}</button>
      ) : null}
    </div>
  );
}
