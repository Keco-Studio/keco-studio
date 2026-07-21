import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './SimulationWorkbench.module.css';

export interface SimulationButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  readonly size?: 'small' | 'medium';
  readonly icon?: ReactNode;
  readonly loading?: boolean;
}

export function SimulationButton({
  variant = 'secondary',
  size = 'medium',
  icon,
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...buttonProps
}: SimulationButtonProps) {
  const classes = [
    styles.button,
    styles[`button_${variant}`],
    styles[`button_${size}`],
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      {...buttonProps}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {icon ? <span className={styles.buttonIcon} aria-hidden="true">{icon}</span> : null}
      <span>{loading ? 'Working...' : children}</span>
    </button>
  );
}
