import { expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';

/** Browser/API boundary fixtures: these never call a model or generation provider. */
export async function agentStream(route: Route, conversationId: string, events: Array<Record<string, unknown>>) {
  await route.fulfill({ status: 200, headers: {
    'Content-Type': 'text/event-stream; charset=utf-8', 'X-Conversation-Id': conversationId,
  }, body: [...events, { type: 'done' }].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') });
}

export function toolEvents(tool: string, data: unknown, displayHint = 'text') {
  return [{ type: 'tool_call_start', tool, args: '{}' }, { type: 'tool_result', tool, success: true, data, displayHint }];
}

export async function mockEmptyAgentHistory(page: Page) {
  await page.route('**/api/agent-chat/conversations**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: [], messages: [], meta: { autoExecute: false } }),
  }));
}

async function withinViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
  return box!;
}

export async function captureAssistantShell(page: Page, testInfo: TestInfo, workspace: string) {
  // Exclude Next's development-only toolbar from production UI evidence.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  const launcher = page.getByTestId('agent-launcher');
  await expect(launcher).toHaveCount(1);
  await expect(launcher).toHaveAttribute('title', 'Keco Assistant');
  await expect(launcher).toHaveCSS('width', '56px');
  await expect(launcher).toHaveCSS('height', '56px');
  const icon = launcher.locator('img');
  await expect(launcher).toHaveAccessibleName('Keco Assistant');
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
  await expect(icon).toHaveAttribute('src', /bot.*\.svg/);
  await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const mobile = testInfo.project.name.includes('mobile');
  if (mobile) {
    await launcher.tap();
    await capturePanel(page, testInfo, workspace);
    await page.getByTestId('agent-panel').getByRole('button', { name: 'Close Keco Agent' }).tap();
    await expect(launcher).toBeVisible();
  }
  const initial = await withinViewport(page, launcher);
  const touchSession = mobile
    ? await page.context().newCDPSession(page) : null;
  // Exercise native touch on mobile and the mouse on desktop without opening.
  if (touchSession) {
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: initial.x + 28, y: initial.y + 28 }] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: initial.x - 50, y: initial.y - 50 }] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(initial.x + 28, initial.y + 28);
    await page.mouse.down();
    await page.mouse.move(initial.x - 50, initial.y - 50, { steps: 8 });
    await page.mouse.up();
  }
  await expect.poll(async () => (await launcher.boundingBox())?.x ?? Infinity).toBeLessThan(initial.x - 20);
  await withinViewport(page, launcher);
  await expect(page.getByTestId('agent-panel')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${workspace}-launcher.png`), fullPage: true });
  await touchSession?.detach();
  if (!mobile) {
    await launcher.click();
    await capturePanel(page, testInfo, workspace);
  }
}

async function capturePanel(page: Page, testInfo: TestInfo, workspace: string) {
  const panel = page.getByTestId('agent-panel');
  await expect(panel).toBeVisible();
  // Wait for the existing panel transition to finish using layout stability.
  await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBeGreaterThanOrEqual(300);
  await withinViewport(page, panel);
  const input = await withinViewport(page, page.getByTestId('agent-input'));
  const history = await withinViewport(page, page.getByTestId('agent-history'));
  const send = await withinViewport(page, page.getByTestId('agent-send'));
  expect(history.y + history.height).toBeLessThan(input.y);
  expect(send.y).toBeGreaterThanOrEqual(input.y + input.height - 1);
  for (const control of [page.getByTestId('agent-history'), panel.getByRole('button', { name: 'Start new chat' }), panel.getByRole('button', { name: 'Close Keco Agent' }), panel.getByRole('button', { name: 'Attach a document or images' })]) {
    await control.click({ trial: true });
    expect(await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
  }
  const transition = await panel.locator('..').evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transition).toContain('0.18s');
  await page.screenshot({ path: testInfo.outputPath(`${workspace}-panel.png`), fullPage: true });
}
