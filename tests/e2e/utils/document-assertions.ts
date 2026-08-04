import { expect, type Page } from '@playwright/test';

/** Wait until the document collaboration session reports a ready label. */
export async function expectDocumentLive(
  page: Page,
  label: 'Live' | 'View only - Live' = 'Live',
  timeout = 45_000
): Promise<void> {
  await expect(page.getByTestId('document-collaboration-status')).toHaveAttribute(
    'data-label',
    label,
    { timeout }
  );
}
