/**
 * Simple Toast Utility
 * 
 * Provides a native browser-based toast notification system
 * without relying on AntD or other UI libraries.
 */

// Inject CSS animations once
let animationsInjected = false;

function injectAnimations() {
  if (animationsInjected) return;
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translate(-50%, -20px);
      }
      to {
        opacity: 1;
        transform: translate(-50%, 0);
      }
    }
    
    @keyframes fadeOut {
      from {
        opacity: 1;
        transform: translate(-50%, 0);
      }
      to {
        opacity: 0;
        transform: translate(-50%, -20px);
      }
    }
  `;
  document.head.appendChild(style);
  animationsInjected = true;
}

export interface ToastOptions {
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
  top?: number;
}

const typeColors = {
  success: '#52c41a',
  error: '#ff4d4f',
  info: '#1890ff',
  warning: '#faad14',
};

/**
 * Show a toast notification
 */
export function showToast(options: ToastOptions) {
  const {
    message,
    type = 'success',
    duration = 3000,
    top = 20,
  } = options;
  
  // Inject animations on first use
  injectAnimations();
  
  // Create toast element
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: ${top}px;
    left: 50%;
    transform: translateX(-50%);
    background: ${typeColors[type]};
    color: white;
    padding: 12px 24px;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    font-size: 14px;
    animation: fadeIn 0.3s ease-in-out;
    pointer-events: none;
  `;
  
  document.body.appendChild(toast);
  
  // Remove after duration
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-in-out';
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

