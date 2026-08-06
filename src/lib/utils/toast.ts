/**
 * Simple Toast Utility
 *
 * Provides a native browser-based toast notification system
 * without relying on AntD or other UI libraries.
 * Unified design: success / error / default, all shown at bottom.
 * Only one toast is visible at a time (new toasts replace the previous).
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
  /** Auto-dismiss ms. Use 0 for a sticky toast until replaced or dismissed. */
  duration?: number;
  bottom?: number;
  testId?: string;
}

/** Design spec: success / error / generating (info & warning map to default blue) */
const toastStyles: Record<'success' | 'error' | 'default', { bg: string; color: string }> = {
  success: { bg: '#F0FAF3', color: '#228B22' },
  error: { bg: '#FEEDEA', color: '#FF0000' },
  default: { bg: '#EAF4FE', color: '#092C6C' },
};

function getToastStyle(type: ToastType): { bg: string; color: string } {
  if (type === 'success') return toastStyles.success;
  if (type === 'error') return toastStyles.error;
  return toastStyles.default;
}

let activeToast: HTMLDivElement | null = null;
let activeDismissTimer: ReturnType<typeof setTimeout> | null = null;
let activeRemoveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Dismiss the current toast immediately (no exit animation if already gone).
 */
export function dismissToast() {
  if (activeDismissTimer) {
    clearTimeout(activeDismissTimer);
    activeDismissTimer = null;
  }
  if (activeRemoveTimer) {
    clearTimeout(activeRemoveTimer);
    activeRemoveTimer = null;
  }
  if (activeToast?.parentNode) {
    activeToast.parentNode.removeChild(activeToast);
  }
  activeToast = null;
}

/**
 * Show a toast notification (bottom-center, design spec colors).
 * Replaces any currently visible toast so messages never stack on top of each other.
 */
export function showToast(options: ToastOptions) {
  const {
    message,
    type = 'default',
    duration = 3000,
    bottom = 24,
    testId,
  } = options;

  injectAnimations();
  dismissToast();

  const { bg, color } = getToastStyle(type);
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  if (testId) toast.setAttribute('data-testid', testId);
  toast.style.cssText = `
    position: fixed;
    bottom: ${bottom}px;
    left: 50%;
    transform: translateX(-50%);
    background: ${bg};
    color: ${color};
    padding: 12px 24px;
    border-radius: 999px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    max-width: min(90vw, 36rem);
    text-align: center;
    animation: toastFadeIn 0.3s ease-in-out;
    pointer-events: none;
  `;

  document.body.appendChild(toast);
  activeToast = toast;

  if (duration > 0) {
    activeDismissTimer = setTimeout(() => {
      activeDismissTimer = null;
      if (activeToast !== toast) return;
      toast.style.animation = 'toastFadeOut 0.3s ease-in-out';
      activeRemoveTimer = setTimeout(() => {
        activeRemoveTimer = null;
        if (activeToast === toast && toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
        if (activeToast === toast) activeToast = null;
      }, 300);
    }, duration);
  }
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
