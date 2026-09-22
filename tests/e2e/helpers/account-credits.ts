import type { Page, Route } from '@playwright/test';
import { AccountStorageMockBackend } from './account-storage';

type CreditsResponse = {
  status: number;
  body: unknown;
};

async function json(route: Route, response: CreditsResponse): Promise<void> {
  await route.fulfill({
    status: response.status,
    contentType: 'application/json',
    body: JSON.stringify(response.body),
  });
}

export class SequencedCreditsBackend extends AccountStorageMockBackend {
  private readonly responses: CreditsResponse[];
  requestCount = 0;

  constructor(responses: CreditsResponse[]) {
    super();
    this.responses = [...responses];
  }

  override async install(page: Page): Promise<void> {
    await super.install(page);
    await page.route('**/api/account/credits', async (route) => {
      const response = this.responses.shift();
      this.requestCount += 1;
      if (!response) throw new Error(`Unexpected Credits request ${this.requestCount}`);
      await json(route, response);
    });
  }
}
