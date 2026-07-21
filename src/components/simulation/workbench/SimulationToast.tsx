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
    <div style={{
      position: 'fixed',
      bottom: 28,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      background: 'var(--simulation-ink-900)',
      color: '#fff',
      padding: '12px 20px',
      borderRadius: 12,
      fontSize: 14,
      fontWeight: 500,
      boxShadow: 'var(--simulation-shadow-popover)',
      zIndex: 200,
    }} role="status" aria-live="polite" aria-atomic="true">
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: tone === 'warning' ? 'var(--simulation-running)' : 'var(--simulation-success)',
      }} />
      {message}
      {onDismiss ? <button type="button" aria-label="Dismiss notification" onClick={onDismiss} style={{ border: 0, background: 'transparent', color: '#fff', cursor: 'pointer' }}>×</button> : null}
    </div>
  );
}
