import { expect, type Locator, type Page } from '@playwright/test';

export class AgentPage {
  readonly page: Page;
  readonly launcher: Locator;
  readonly panel: Locator;
  readonly input: Locator;
  readonly sendButton: Locator;
  readonly historyButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.launcher = page.getByTestId('agent-launcher');
    this.panel = page.getByTestId('agent-panel');
    this.input = page.getByTestId('agent-input');
    this.sendButton = page.getByTestId('agent-send');
    this.historyButton = page.getByTestId('agent-history');
  }

  async open(): Promise<void> {
    await expect(this.launcher).toBeVisible({ timeout: 30000 });
    await this.launcher.click();
    await expect(this.panel).toBeVisible();
  }

  async send(message: string): Promise<void> {
    await this.input.fill(message);
    await this.sendButton.click();
  }
}
