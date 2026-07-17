import type { Page } from '@playwright/test';

const REALTIME_ERROR_MARKERS = [
  'IncreaseConnectionPool',
  'Too many database timeouts',
  '[Sidebar] Projects channel ERROR',
  '[Sidebar] Project channel ERROR',
] as const;

function isTargetRealtimeError(message: string): boolean {
  return REALTIME_ERROR_MARKERS.some((marker) => message.includes(marker));
}

export function captureRealtimeErrors(
  page: Page,
  source: string
): readonly string[] {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isTargetRealtimeError(text)) errors.push(`${source} console: ${text}`);
  });
  page.on('pageerror', (error) => {
    if (isTargetRealtimeError(error.message)) {
      errors.push(`${source} pageerror: ${error.message}`);
    }
  });

  return errors;
}
