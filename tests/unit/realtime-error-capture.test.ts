import type { ConsoleMessage, Page } from '@playwright/test';
import { captureRealtimeErrors } from '../e2e/utils/realtime-errors';

type ConsoleHandler = (message: ConsoleMessage) => void;
type PageErrorHandler = (error: Error) => void;

class PageEventFake {
  private consoleHandlers: ConsoleHandler[] = [];
  private pageErrorHandlers: PageErrorHandler[] = [];

  on(event: 'console', handler: ConsoleHandler): void;
  on(event: 'pageerror', handler: PageErrorHandler): void;
  on(
    event: 'console' | 'pageerror',
    handler: ConsoleHandler | PageErrorHandler
  ): void {
    if (event === 'console') {
      this.consoleHandlers.push(handler as ConsoleHandler);
      return;
    }
    this.pageErrorHandlers.push(handler as PageErrorHandler);
  }

  emitConsole(type: string, text: string): void {
    const message = { type: () => type, text: () => text } as ConsoleMessage;
    this.consoleHandlers.forEach((handler) => handler(message));
  }

  emitPageError(message: string): void {
    const error = new Error(message);
    this.pageErrorHandlers.forEach((handler) => handler(error));
  }
}

describe('captureRealtimeErrors', () => {
  it('captures only target Realtime errors with their source labels', () => {
    const page = new PageEventFake();
    const errors = captureRealtimeErrors(page as unknown as Page, 'owner');

    page.emitConsole(
      'error',
      '[Sidebar] Project channel ERROR: IncreaseConnectionPool'
    );
    page.emitConsole('warning', '[Sidebar] Projects channel ERROR');
    page.emitConsole('error', 'An unrelated browser error');
    page.emitPageError('Too many database timeouts');
    page.emitPageError('An unrelated page error');

    expect(errors).toEqual([
      'owner console: [Sidebar] Project channel ERROR: IncreaseConnectionPool',
      'owner pageerror: Too many database timeouts',
    ]);
  });
});
