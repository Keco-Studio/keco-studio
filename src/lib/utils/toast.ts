/**
 * Simple Toast Utility
 *
 * Provides a native browser-based toast notification system
 * without relying on AntD or other UI libraries.
 * Unified design: success / error / default, all shown at bottom.
 */

// Inject CSS animations once
let animationsInjected = false;

function injectAnimations() {
  if (animationsInjected) return;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes toastFadeIn {
      from {
        opacity: 0;
        transform: translate(-50%, 20px);
      }
      to {
        opacity: 1;
        transform: translate(-50%, 0);
      }
    }
    @keyframes toastFadeOut {
      from {
        opacity: 1;
        transform: translate(-50%, 0);
      }
      to {
        opacity: 0;
        transform: translate(-50%, 20px);
      }
    }
  `;
  document.head.appendChild(style);
  animationsInjected = true;
}

export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'default';

export interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
  bottom?: number;
}

/** Design spec: success / error / default (info & warning map to default) */
const toastStyles: Record<'success' | 'error' | 'default', { bg: string; color: string }> = {
  success: { bg: '#F0FAF3', color: '#228B22' },
  error: { bg: '#FFF0F0', color: '#FF0000' },
  default: { bg: '#F0F8FF', color: '#000000' },
};

function getToastStyle(type: ToastType): { bg: string; color: string } {
  if (type === 'success') return toastStyles.success;
  if (type === 'error') return toastStyles.error;
  return toastStyles.default;
}

/**
 * Show a toast notification (bottom-center, design spec colors)
 */
export function showToast(options: ToastOptions) {
  const {
    message,
    type = 'default',
    duration = 3000,
    bottom = 24,
  } = options;

  injectAnimations();
  const { bg, color } = getToastStyle(type);

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: ${bottom}px;
    left: 50%;
    transform: translateX(-50%);
    background: ${bg};
    color: ${color};
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    animation: toastFadeIn 0.3s ease-in-out;
    pointer-events: none;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastFadeOut 0.3s ease-in-out';
    setTimeout(() => {
      if (toast.parentNode) {
        document.body.removeChild(toast);
      }
    }, 300);
  }, duration);
}

/**
 * Show a success toast
 */
export function showSuccessToast(message: string, duration?: number) {
  showToast({ message, type: 'success', duration });
}

/**
 * Show an error toast
 */
export function showErrorToast(message: string, duration?: number) {
  showToast({ message, type: 'error', duration });
}

/**
 * Show an info toast
 */
export function showInfoToast(message: string, duration?: number) {
  showToast({ message, type: 'info', duration });
}

/**
 * Show a warning toast
 */
export function showWarningToast(message: string, duration?: number) {
  showToast({ message, type: 'warning', duration });
}

