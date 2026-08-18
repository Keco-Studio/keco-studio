import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildAgentSystemMessage } from '@/lib/agent/core';
import { PIXEL_ART_V1_PRESET } from '@/lib/game-art-style/presets';
import type { GameArtStyleSnapshot } from '@/lib/game-art-style/schema';
import type { GameDesignRuleSet } from '@/lib/game-design-system/ruleSchema';
import type {
  GameDesignSystem,
  GameDesignSystemDetail,
  GameDesignSystemGenerationJob,
  GameDesignSystemVersion,
} from '@/lib/services/gameDesignSystemService';
import { LoginPage } from '../pages/login.page';
import {
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

const DOCUMENT_CONSTRAINT = 'Every tactical choice must expose stamina cost before confirmation.';
const TABLE_ROW_VALUE = 'Arc Bolt';
const VERSION_THREE_ONLY = 'version-three-only-policy-marker';
const ART_DIRECTION = 'Favor compact village silhouettes and clear traversal landmarks.';
const VISUAL_REFERENCE_NAME = 'Into the Breach';
const VISUAL_REFERENCE_BORROW = 'Borrow its immediate board-state readability and restrained effects.';
const ART_AVOID = 'Avoid noisy outlines, muddy values, and oversized combat effects.';
const EVIDENCE_DIR = path.resolve(process.cwd(), '.superpowers/evidence/game-art-style/task-6');
const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const MOCK_USER_ID = '10000000-0000-4000-8000-000000000061';
const MOCK_PROJECT_ID = '20000000-0000-4000-8000-000000000062';
const MOCK_SYSTEM_ID = '30000000-0000-4000-8000-000000000063';
const MOCK_LEGACY_SYSTEM_ID = '40000000-0000-4000-8000-000000000064';
const MOCK_CURRENT_VERSION_ID = '50000000-0000-4000-8000-000000000065';
const MOCK_HISTORICAL_VERSION_ID = '60000000-0000-4000-8000-000000000066';
const MOCK_LEGACY_VERSION_ID = '70000000-0000-4000-8000-000000000067';
const MOCK_INITIAL_JOB_ID = '80000000-0000-4000-8000-000000000068';
const MOCK_FAILED_JOB_ID = '81000000-0000-4000-8000-000000000069';
const MOCK_RETRY_JOB_ID = '82000000-0000-4000-8000-000000000070';

const LEGACY_RULES: GameDesignRuleSet = {
  schemaVersion: 1,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Legacy tactical games',
  rules: [{
    id: 'legacy-readable-state',
    kind: 'principle',
    title: 'Legacy readable state',
    statement: 'Expose the information needed to compare actions.',
    appliesWhen: 'Presenting a tactical choice.',
    severity: 'required',
  }],
  tableGuidance: [],
};

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
}

async function expectNoVisibleTextOverflow(root: Locator): Promise<void> {
  const overflow = await root.locator('h3, h4, p, dt, dd, strong, small, figcaption').evaluateAll((elements) =>
    elements
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && element.scrollWidth > element.clientWidth + 1;
      })
      .map((element) => element.textContent?.trim() ?? ''),
  );
  expect(overflow).toEqual([]);
}

async function resetViewportScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
    document.querySelectorAll<HTMLElement>('*').forEach((element) => {
      if (element.scrollTop > 0) element.scrollTop = 0;
      if (element.scrollLeft > 0) element.scrollLeft = 0;
    });
  });
}

async function expectScrollableSingleLineTabRail(tablist: Locator): Promise<void> {
  const metrics = await tablist.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
    lineCounts: Array.from(element.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => {
      const range = document.createRange();
      range.selectNodeContents(tab);
      return new Set(Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.top))).size;
    }),
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.overflowX).toBe('auto');
  expect(metrics.lineCounts).toEqual([1, 1, 1, 1, 1, 1]);

  await tablist.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const trailingTab = tablist.getByRole('tab', { name: 'Projects' });
  await expect(trailingTab).toBeInViewport();
  const [tablistBox, trailingTabBox] = await Promise.all([tablist.boundingBox(), trailingTab.boundingBox()]);
  expect(tablistBox).not.toBeNull();
  expect(trailingTabBox).not.toBeNull();
  expect(trailingTabBox!.x).toBeGreaterThanOrEqual(tablistBox!.x - 1);
  expect(trailingTabBox!.x + trailingTabBox!.width).toBeLessThanOrEqual(tablistBox!.x + tablistBox!.width + 1);
}

async function expectLoadedArtStyleImages(page: Page): Promise<void> {
  const previews = [
    { alt: PIXEL_ART_V1_PRESET.previewAssetSet.map.alt, width: 168, height: 96, ratio: 7 / 4 },
    { alt: PIXEL_ART_V1_PRESET.previewAssetSet.character.alt, width: 96, height: 96, ratio: 1 },
  ];
  for (const preview of previews) {
    const image = page.getByRole('img', { name: preview.alt });
    await expect(image).toBeVisible();
    await expect.poll(
      () => image.evaluate((element: HTMLImageElement) => ({
        complete: element.complete,
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
      })),
      { timeout: 30_000 },
    ).toMatchObject({
      complete: true,
      naturalWidth: preview.width,
      naturalHeight: preview.height,
    });
    const pixels = await image.evaluate((element: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaquePixels = 0;
      let minimum = 255;
      let maximum = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] === 0) continue;
        opaquePixels += 1;
        minimum = Math.min(minimum, data[index], data[index + 1], data[index + 2]);
        maximum = Math.max(maximum, data[index], data[index + 1], data[index + 2]);
      }
      const rendered = element.getBoundingClientRect();
      return {
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
        renderedWidth: rendered.width,
        renderedHeight: rendered.height,
        imageRendering: getComputedStyle(element).imageRendering,
        opaquePixels,
        channelRange: maximum - minimum,
      };
    });
    expect(pixels).toEqual(expect.objectContaining({
      naturalWidth: preview.width,
      naturalHeight: preview.height,
      imageRendering: 'pixelated',
    }));
    expect(pixels?.opaquePixels).toBeGreaterThan(0);
    expect(pixels?.channelRange).toBeGreaterThan(16);
    const widthScale = pixels!.renderedWidth / preview.width;
    const heightScale = pixels!.renderedHeight / preview.height;
    expect(widthScale).toBeGreaterThanOrEqual(1);
    expect(Math.abs(widthScale - Math.round(widthScale))).toBeLessThan(0.01);
    expect(Math.abs(heightScale - Math.round(heightScale))).toBeLessThan(0.01);
    expect(Math.abs(widthScale - heightScale)).toBeLessThan(0.01);
    const frame = await image.locator('xpath=..').boundingBox();
    expect(frame).not.toBeNull();
    expect(Math.abs(frame!.width / frame!.height - preview.ratio)).toBeLessThan(0.08);
  }
}

const MOCK_TITLE = 'Mock Art Style Rules';
const MOCK_DOCUMENT = {
  designIntent: 'Make every tactical choice legible and consequential.',
  playerFantasy: 'Lead a small squad through uncertain encounters.',
  coreLoop: 'Scout, commit resources, resolve the encounter, and adapt the squad.',
  decisionStructure: 'Compare visible costs, risks, and future positioning.',
  systemBoundaries: 'Never conceal action costs from the player.',
  progressionEconomy: 'Expand tactical options without replacing player judgment.',
  contentModel: 'Define skills, encounters, enemies, and rewards as reusable data.',
  difficultyBalance: 'Increase difficulty through richer situations rather than opaque inflation.',
  experiencePresentation: 'Preview consequences and explain state changes.',
};
const MOCK_RULES: GameDesignRuleSet = {
  schemaVersion: 1,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Single-player tactical games',
  rules: [{
    id: 'readable-state',
    kind: 'principle',
    title: 'Readable state',
    statement: 'Show decision inputs before commitment.',
    appliesWhen: 'Presenting a player choice.',
    severity: 'required',
  }],
  tableGuidance: [],
};

function mockArtStyle(customization: GameArtStyleSnapshot['customization']): GameArtStyleSnapshot {
  const snapshot = structuredClone(PIXEL_ART_V1_PRESET) as GameArtStyleSnapshot;
  snapshot.customization = customization;
  return snapshot;
}

function mockVersion(input: {
  id: string;
  systemId: string;
  version: number;
  parentId: string | null;
  rules?: GameDesignRuleSet;
  artStyle: GameArtStyleSnapshot | null;
}): GameDesignSystemVersion {
  return {
    id: input.id,
    system_id: input.systemId,
    version_number: input.version,
    parent_version_id: input.parentId,
    document: MOCK_DOCUMENT,
    rules: input.rules ?? MOCK_RULES,
    artStyle: input.artStyle,
    rendered_markdown: `# ${MOCK_TITLE}\n\n> Version: ${input.version}\n`,
    source_snapshots: [],
    diff: { added: ['readable-state'], removed: [], changed: [], conflicts: [] },
    conflicts: [],
    content_hash: String(input.version).repeat(64),
    created_by: MOCK_USER_ID,
    created_at: `2026-08-17T0${input.version}:00:00.000Z`,
  };
}

function mockSystem(input: {
  id: string;
  title: string;
  currentVersionId: string;
}): GameDesignSystem {
  return {
    id: input.id,
    owner_id: MOCK_USER_ID,
    source: 'user',
    title: input.title,
    summary: 'Offline browser acceptance fixture.',
    genres: ['Strategy'],
    philosophies: ['Readable Systems'],
    suitable_for: 'Single-player tactical games',
    body: '',
    provenance: {},
    status: 'draft',
    current_version_id: input.currentVersionId,
    migration_status: 'ready',
    generation_job_id: MOCK_RETRY_JOB_ID,
    created_at: '2026-08-17T00:00:00.000Z',
    updated_at: '2026-08-17T03:00:00.000Z',
  };
}

function mockJwt(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: MOCK_USER_ID,
    role: 'authenticated',
    email: 'gds-art-style-e2e@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;
}

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

class GameArtStyleMockBackend {
  readonly generationBodies: Array<Record<string, unknown>> = [];
  readonly issuedJobIds: string[] = [];
  readonly polledJobIds: string[] = [];
  retryCalls = 0;
  readonly currentArtStyle = mockArtStyle({
    direction: ART_DIRECTION,
    referenceGames: [{ name: VISUAL_REFERENCE_NAME, borrow: VISUAL_REFERENCE_BORROW }],
    avoid: ART_AVOID,
  });
  readonly historicalArtStyle = mockArtStyle({
    direction: 'Historical amber route markers and compact landmark clusters.',
    referenceGames: [{ name: 'Chrono Trigger', borrow: 'Borrow its historical landmark grouping.' }],
    avoid: 'Avoid dense historical decoration.',
  });
  readonly currentVersion = mockVersion({
    id: MOCK_CURRENT_VERSION_ID,
    systemId: MOCK_SYSTEM_ID,
    version: 2,
    parentId: MOCK_HISTORICAL_VERSION_ID,
    artStyle: this.currentArtStyle,
  });
  readonly historicalVersion = mockVersion({
    id: MOCK_HISTORICAL_VERSION_ID,
    systemId: MOCK_SYSTEM_ID,
    version: 1,
    parentId: null,
    artStyle: this.historicalArtStyle,
  });
  readonly legacyVersion = mockVersion({
    id: MOCK_LEGACY_VERSION_ID,
    systemId: MOCK_LEGACY_SYSTEM_ID,
    version: 1,
    parentId: null,
    rules: LEGACY_RULES,
    artStyle: null,
  });
  readonly generatedSystem = mockSystem({
    id: MOCK_SYSTEM_ID,
    title: MOCK_TITLE,
    currentVersionId: MOCK_CURRENT_VERSION_ID,
  });
  readonly legacySystem = mockSystem({
    id: MOCK_LEGACY_SYSTEM_ID,
    title: 'Legacy Art Style Fixture',
    currentVersionId: MOCK_LEGACY_VERSION_ID,
  });

  async install(page: Page): Promise<void> {
    await page.route(`${SUPABASE_ORIGIN}/**`, (route) => this.handleSupabase(route));
    await page.route('**/api/projects/*/role', (route) => fulfillJson(route, { role: 'admin', isOwner: true }));
    await page.route('**/api/projects', (route) => fulfillJson(route, [{ id: MOCK_PROJECT_ID, name: 'Art Style E2E Project' }]));
    await page.route('**/api/game-design-systems**', (route) => this.handleGameDesignSystem(route));
  }

  private job(id: string, status: GameDesignSystemGenerationJob['status'], phase: GameDesignSystemGenerationJob['phase']): GameDesignSystemGenerationJob {
    const completed = status === 'completed';
    return {
      id,
      owner_id: MOCK_USER_ID,
      status,
      phase,
      input: {},
      error: status === 'failed' ? 'Mock durable worker unavailable.' : null,
      design_system_id: completed ? MOCK_SYSTEM_ID : null,
      output_version_id: completed ? MOCK_CURRENT_VERSION_ID : null,
      idempotency_key: 'mock-game-art-style-job',
      input_hash: 'a'.repeat(64),
      attempt_count: 1,
      max_attempts: 3,
      available_at: '2026-08-17T04:00:00.000Z',
      lease_owner: null,
      lease_expires_at: null,
      heartbeat_at: null,
      started_at: null,
      completed_at: completed ? '2026-08-17T04:00:00.000Z' : null,
      created_at: '2026-08-17T03:00:00.000Z',
      updated_at: '2026-08-17T04:00:00.000Z',
    };
  }

  private detail(systemId: string): GameDesignSystemDetail | null {
    if (systemId === MOCK_SYSTEM_ID) {
      return {
        ...this.generatedSystem,
        current_version: this.currentVersion,
        versions: [this.currentVersion, this.historicalVersion],
      };
    }
    if (systemId === MOCK_LEGACY_SYSTEM_ID) {
      return {
        ...this.legacySystem,
        current_version: this.legacyVersion,
        versions: [this.legacyVersion],
      };
    }
    return null;
  }

  private async handleGameDesignSystem(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/game-design-systems' && request.method() === 'GET') {
      return fulfillJson(route, { systems: [this.generatedSystem, this.legacySystem] });
    }
    if (path === '/api/game-design-systems/reference-options') {
      return fulfillJson(route, { options: [] });
    }
    if (path === '/api/game-design-systems/generation-jobs' && request.method() === 'POST') {
      this.generationBodies.push(request.postDataJSON() as Record<string, unknown>);
      const jobId = this.generationBodies.length === 1 ? MOCK_INITIAL_JOB_ID : MOCK_FAILED_JOB_ID;
      const job = this.job(jobId, 'failed', 'failed');
      this.issuedJobIds.push(job.id);
      return fulfillJson(route, { job }, 202);
    }
    if (path === `/api/game-design-systems/generation-jobs/${MOCK_FAILED_JOB_ID}/retry` && request.method() === 'POST') {
      this.retryCalls += 1;
      const job = this.job(MOCK_RETRY_JOB_ID, 'queued', 'collecting');
      this.issuedJobIds.push(job.id);
      return fulfillJson(route, { job }, 202);
    }
    if (path === `/api/game-design-systems/generation-jobs/${MOCK_INITIAL_JOB_ID}` && request.method() === 'GET') {
      this.polledJobIds.push(MOCK_INITIAL_JOB_ID);
      return fulfillJson(route, { job: this.job(MOCK_INITIAL_JOB_ID, 'failed', 'failed') });
    }
    if (path === `/api/game-design-systems/generation-jobs/${MOCK_FAILED_JOB_ID}` && request.method() === 'GET') {
      this.polledJobIds.push(MOCK_FAILED_JOB_ID);
      return fulfillJson(route, { job: this.job(MOCK_FAILED_JOB_ID, 'failed', 'failed') });
    }
    if (path === `/api/game-design-systems/generation-jobs/${MOCK_RETRY_JOB_ID}` && request.method() === 'GET') {
      this.polledJobIds.push(MOCK_RETRY_JOB_ID);
      return fulfillJson(route, { job: this.job(MOCK_RETRY_JOB_ID, 'completed', 'completed') });
    }
    const detail = this.detail(path.split('/').at(-1) ?? '');
    if (detail && request.method() === 'GET') return fulfillJson(route, { system: detail });
    return fulfillJson(route, { error: 'Unhandled mock Game Design System route.' }, 404);
  }

  private async handleSupabase(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/auth/v1/token') {
      return fulfillJson(route, {
        access_token: mockJwt(),
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: { id: MOCK_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'gds-art-style-e2e@example.com' },
      });
    }
    if (path === '/auth/v1/user') {
      return fulfillJson(route, { id: MOCK_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'gds-art-style-e2e@example.com' });
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (path === '/rest/v1/profiles') {
      const profile = { id: MOCK_USER_ID, email: 'gds-art-style-e2e@example.com', username: 'GDS Art Style E2E' };
      return fulfillJson(route, request.headers().accept?.includes('application/vnd.pgrst.object') ? profile : [profile]);
    }
    if (path === '/rest/v1/project_collaborators') {
      return fulfillJson(route, [{ id: '90000000-0000-4000-8000-000000000069', project_id: MOCK_PROJECT_ID, role: 'admin', accepted_at: '2026-08-17T00:00:00.000Z' }]);
    }
    if (path === '/rest/v1/projects') {
      return fulfillJson(route, [{ id: MOCK_PROJECT_ID, owner_id: MOCK_USER_ID, name: 'Art Style E2E Project', description: null }]);
    }
    return fulfillJson(route, []);
  }
}

async function loginWithMockBackend(page: Page, backend: GameArtStyleMockBackend): Promise<void> {
  await backend.install(page);
  await page.goto('/');
  await page.getByLabel('Email').fill('gds-art-style-e2e@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Password123!');
  await Promise.all([
    page.waitForURL(/\/projects$/, { timeout: 15_000 }),
    page.getByRole('button', { name: 'Login', exact: true }).click(),
  ]);
  await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 15_000 });
  await page.goto('/game-design-systems');
  await expect(page.getByRole('heading', { name: MOCK_TITLE, exact: true })).toBeVisible();
}

async function createAuthenticatedClient(user: TemporaryUser): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('E2E Supabase user environment is not configured.');
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}

test.describe('Game Design System mocked Art Style acceptance', () => {
  test.describe.configure({ timeout: 90_000 });

  test('covers create, retry, current, historical, and legacy Art Style states', async ({ page }) => {
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const pixelLabRequests: string[] = [];
    page.on('request', (request) => {
      if (/pixellab/i.test(request.url())) pixelLabRequests.push(request.url());
    });
    const backend = new GameArtStyleMockBackend();
    await loginWithMockBackend(page, backend);

    await page.getByRole('button', { name: 'Create Game Design System' }).click();
    const createTabs = page.getByRole('tablist', { name: 'Creation stages' });
    expect(await createTabs.getByRole('tab').evaluateAll((tabs) =>
      tabs.map((tab) => tab.getAttribute('aria-label')),
    )).toEqual(['Foundation', 'Art Style', 'Sources', 'Review']);
    await page.getByLabel('System name').fill(MOCK_TITLE);
    await page.getByRole('button', { name: 'RPG', exact: true }).click();
    await page.getByRole('button', { name: 'Continue to art style' }).click();
    await expect(page.getByRole('tab', { name: 'Art Style' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('radio', { name: 'Pixel Art, selected and locked' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Pixel Art, selected and locked' })).toBeDisabled();
    await expectLoadedArtStyleImages(page);
    await page.getByLabel('Custom art direction').fill(ART_DIRECTION);
    await page.getByRole('button', { name: 'Add visual reference' }).click();
    await page.getByLabel('Visual reference game 1').fill(VISUAL_REFERENCE_NAME);
    await page.getByLabel('What to borrow 1').fill(VISUAL_REFERENCE_BORROW);
    await page.getByLabel('Visual avoid guidance').fill(ART_AVOID);

    await resetViewportScroll(page);
    const desktopCatalog = await page.getByLabel('Art style catalog').boundingBox();
    const desktopPreview = await page.getByRole('region', { name: 'Pixel Art preview' }).boundingBox();
    expect(desktopCatalog).not.toBeNull();
    expect(desktopPreview).not.toBeNull();
    expect(desktopCatalog!.x + desktopCatalog!.width).toBeLessThanOrEqual(desktopPreview!.x);
    await expectNoVisibleTextOverflow(page.getByRole('region', { name: 'Pixel Art preview' }));
    await expectNoDocumentOverflow(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'create-art-style-1440x1000.png'), fullPage: true });

    await page.setViewportSize({ width: 768, height: 900 });
    await resetViewportScroll(page);
    const tabletCatalog = await page.getByLabel('Art style catalog').boundingBox();
    const tabletPreview = await page.getByRole('region', { name: 'Pixel Art preview' }).boundingBox();
    const tabletDirection = await page.getByLabel('Custom art direction').boundingBox();
    expect(tabletCatalog).not.toBeNull();
    expect(tabletPreview).not.toBeNull();
    expect(tabletDirection).not.toBeNull();
    expect(tabletCatalog!.y + tabletCatalog!.height).toBeLessThanOrEqual(tabletPreview!.y);
    expect(tabletPreview!.y + tabletPreview!.height).toBeLessThanOrEqual(tabletDirection!.y);
    await expectNoVisibleTextOverflow(page.getByRole('region', { name: 'Pixel Art preview' }));
    await expectNoDocumentOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await resetViewportScroll(page);
    await expectLoadedArtStyleImages(page);
    expect(await page.locator('[aria-label="Art style catalog"], [aria-label="Pixel Art preview"], #gds-art-direction').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-label') || element.id),
    )).toEqual(['Art style catalog', 'Pixel Art preview', 'gds-art-direction']);
    const narrowCatalog = await page.getByLabel('Art style catalog').boundingBox();
    const narrowPreview = await page.getByRole('region', { name: 'Pixel Art preview' }).boundingBox();
    const narrowDirection = await page.getByLabel('Custom art direction').boundingBox();
    expect(narrowCatalog).not.toBeNull();
    expect(narrowPreview).not.toBeNull();
    expect(narrowDirection).not.toBeNull();
    expect(narrowCatalog!.y + narrowCatalog!.height).toBeLessThanOrEqual(narrowPreview!.y);
    expect(narrowPreview!.y + narrowPreview!.height).toBeLessThanOrEqual(narrowDirection!.y);
    await expectNoVisibleTextOverflow(page.getByRole('region', { name: 'Pixel Art preview' }));
    await expectNoDocumentOverflow(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'create-art-style-390x844.png'), fullPage: true });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Continue to sources' }).click();
    await page.getByRole('button', { name: 'Review input' }).click();
    const artStyleSummary = page.getByLabel('Art Style summary');
    await expect(artStyleSummary).toContainText('Pixel Art');
    await expect(artStyleSummary).toContainText('Revision 1');
    await expect(artStyleSummary).toContainText(ART_DIRECTION);
    await expect(artStyleSummary).toContainText(`${VISUAL_REFERENCE_NAME}: ${VISUAL_REFERENCE_BORROW}`);
    await expect(artStyleSummary).toContainText(ART_AVOID);
    await page.getByRole('button', { name: 'Generate system' }).click();
    await expect(page.getByRole('heading', { name: 'Generation incomplete' })).toBeVisible();
    await expect(page.getByText('Mock durable worker unavailable.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Back to sources' }).click();
    await page.getByRole('tab', { name: 'Art Style' }).click();
    await expect(page.getByLabel('Custom art direction')).toHaveValue(ART_DIRECTION);
    await expect(page.getByLabel('Visual reference game 1')).toHaveValue(VISUAL_REFERENCE_NAME);
    await expect(page.getByLabel('What to borrow 1')).toHaveValue(VISUAL_REFERENCE_BORROW);
    await expect(page.getByLabel('Visual avoid guidance')).toHaveValue(ART_AVOID);
    await page.getByRole('button', { name: 'Continue to sources' }).click();
    await page.getByRole('button', { name: 'Review input' }).click();
    await page.getByRole('button', { name: 'Generate system' }).click();
    await expect(page.getByRole('heading', { name: 'Generation incomplete' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry job' }).click();
    await expect(page.getByRole('heading', { name: 'Generating Game Design System' })).toBeVisible();
    await expect(page.getByRole('heading', { name: MOCK_TITLE, exact: true })).toBeVisible({ timeout: 15_000 });

    expect(backend.generationBodies).toHaveLength(2);
    for (const body of backend.generationBodies) {
      expect(body.artStyle).toEqual({
        presetId: 'pixel-art',
        presetVersion: 1,
        customization: {
          direction: ART_DIRECTION,
          referenceGames: [{ name: VISUAL_REFERENCE_NAME, borrow: VISUAL_REFERENCE_BORROW }],
          avoid: ART_AVOID,
        },
      });
      expect(body.artStyle).not.toHaveProperty('specification');
      expect(body.artStyle).not.toHaveProperty('previewAssetSet');
    }
    expect(backend.retryCalls).toBe(1);
    expect(backend.issuedJobIds).toEqual([
      MOCK_INITIAL_JOB_ID,
      MOCK_FAILED_JOB_ID,
      MOCK_RETRY_JOB_ID,
    ]);
    expect(backend.polledJobIds).toContain(MOCK_RETRY_JOB_ID);
    expect(backend.polledJobIds).not.toContain(MOCK_FAILED_JOB_ID);
    expect(pixelLabRequests).toEqual([]);

    await page.getByRole('tab', { name: 'Art Style' }).click();
    const currentPreview = page.getByRole('region', { name: 'Pixel Art preview' });
    await expectLoadedArtStyleImages(page);
    await expect(currentPreview).toContainText(ART_DIRECTION);
    await expect(currentPreview).toContainText(VISUAL_REFERENCE_NAME);
    await expect(currentPreview).toContainText(VISUAL_REFERENCE_BORROW);
    await expect(currentPreview).toContainText(ART_AVOID);
    await expectNoVisibleTextOverflow(currentPreview);
    await expectNoDocumentOverflow(page);
    await resetViewportScroll(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'workspace-art-style-1440x1000.png'), fullPage: true });

    await page.getByRole('img', { name: PIXEL_ART_V1_PRESET.previewAssetSet.character.alt }).evaluate((image) => {
      image.dispatchEvent(new Event('error'));
    });
    await expect(page.getByRole('status', { name: new RegExp(`Character preview unavailable.*${PIXEL_ART_V1_PRESET.previewAssetSet.character.alt}`) })).toBeVisible();
    await expect(page.getByRole('img', { name: PIXEL_ART_V1_PRESET.previewAssetSet.map.alt })).toBeVisible();
    await expect(currentPreview).toContainText(ART_DIRECTION);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'workspace-art-style-failed-image-1440x1000.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    const versionSelect = page.getByRole('combobox', { name: 'Version' });
    await versionSelect.selectOption(MOCK_HISTORICAL_VERSION_ID);
    await expect(versionSelect.locator('option:checked')).toHaveText('Version 1');
    await expect(page.getByText('Historical amber route markers and compact landmark clusters.', { exact: true })).toBeVisible();
    await expect(page.getByText('Chrono Trigger', { exact: true })).toBeVisible();
    await expectLoadedArtStyleImages(page);
    const workspaceTabs = page.getByRole('tablist', { name: 'Game Design System views' });
    expect(await workspaceTabs.getByRole('tab').allTextContents()).toEqual([
      'Overview', 'Art Style', 'Rules', 'Versions', 'Sources', 'Projects',
    ]);
    await expectNoVisibleTextOverflow(page.getByRole('region', { name: 'Pixel Art preview' }));
    await expectNoDocumentOverflow(page);
    await expectScrollableSingleLineTabRail(workspaceTabs);
    await resetViewportScroll(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'workspace-art-style-390x844.png'), fullPage: true });

    await page.getByRole('button', { name: 'Show system library' }).click();
    await page.getByRole('button', { name: /Legacy Art Style Fixture/ }).click();
    await expect(page.getByRole('heading', { name: 'Legacy Art Style Fixture', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Art Style' }).click();
    await expect(page.getByText('No art style specified', { exact: true })).toBeVisible();
    await expectNoDocumentOverflow(page);
    expect(pixelLabRequests).toEqual([]);
  });
});

test.describe('Game Design System real workflow', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let viewer: TemporaryUser;
  let projectId: string;
  let viewerProjectId: string;
  let documentName: string;
  let libraryName: string;
  let systemId: string | null = null;
  let legacySystemId: string | null = null;
  let cronSystemId: string | null = null;
  let cronJobId: string | null = null;

  test.beforeAll(async () => {
    await mkdir(EVIDENCE_DIR, { recursive: true });
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'game-design-system');
    viewer = await createTemporaryUser(admin, 'game-design-system-viewer');
    projectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });
    viewerProjectId = await createProjectFixture(admin, viewer.id, { addOwnerMembership: true });
    documentName = `Combat GDD ${Date.now()}`;
    libraryName = `Skills ${Date.now()}`;

    const { error: documentError } = await admin.from('documents').insert({
      project_id: projectId,
      name: documentName,
      content: `# Combat\n\n${DOCUMENT_CONSTRAINT}\n\nDecisions must remain reversible during onboarding.`,
      created_by: owner.id,
    });
    if (documentError) throw documentError;

    const { data: library, error: libraryError } = await admin.from('libraries')
      .insert({ project_id: projectId, name: libraryName })
      .select('id').single();
    if (libraryError || !library) throw libraryError ?? new Error('Could not create source table.');
    const sectionId = `${library.id}:General`;
    const { data: fields, error: fieldsError } = await admin.from('library_field_definitions').insert([
      { library_id: library.id, section_id: sectionId, section: 'General', label: 'Skill Name', data_type: 'string', order_index: 0, required: true },
      { library_id: library.id, section_id: sectionId, section: 'General', label: 'Energy Cost', data_type: 'int', order_index: 1, required: true },
    ]).select('id,order_index');
    if (fieldsError || !fields) throw fieldsError ?? new Error('Could not create source fields.');
    const { data: asset, error: assetError } = await admin.from('library_assets')
      .insert({ library_id: library.id, name: TABLE_ROW_VALUE, row_index: 0 })
      .select('id').single();
    if (assetError || !asset) throw assetError ?? new Error('Could not create source row.');
    const nameField = fields.find((field) => field.order_index === 0)?.id;
    const costField = fields.find((field) => field.order_index === 1)?.id;
    if (!nameField || !costField) throw new Error('Source fields were not returned.');
    const { error: valuesError } = await admin.from('library_asset_values').insert([
      { asset_id: asset.id, field_id: nameField, value_json: TABLE_ROW_VALUE },
      { asset_id: asset.id, field_id: costField, value_json: 3 },
    ]);
    if (valuesError) throw valuesError;
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId).catch(() => undefined);
    if (viewerProjectId) await removeProjectFixture(admin, viewerProjectId).catch(() => undefined);
    if (systemId) await admin.from('game_design_systems').delete().eq('id', systemId);
    if (legacySystemId) await admin.from('game_design_systems').delete().eq('id', legacySystemId);
    if (cronSystemId) await admin.from('game_design_systems').delete().eq('id', cronSystemId);
    if (cronJobId) await admin.from('game_design_system_generation_jobs').delete().eq('id', cronJobId);
    if (viewer) await deleteTemporaryUser(admin, viewer).catch(() => undefined);
    if (owner) await deleteTemporaryUser(admin, owner).catch(() => undefined);
  });

  test('keeps the product rail and creation flow in one responsive workspace', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const login = new LoginPage(page);
    await login.goto();
    await login.login(owner);
    await login.expectLoginSuccess();

    await page.goto('/game-design-systems');
    await expect(page.getByRole('button', { name: 'Game Design System', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('tab', { name: /My Systems/ })).toBeVisible();
    await page.getByRole('tab', { name: /Official/ }).click();
    await expect(page.getByText('No official systems yet.', { exact: true })).toBeVisible();

    const workspaceUrl = page.url();
    await page.getByRole('button', { name: 'Create Game Design System' }).click();
    await expect(page).toHaveURL(workspaceUrl);
    await expect(page.getByRole('tab', { name: 'Foundation' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('System name')).toBeVisible();
    await expectNoDocumentOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Game Design System', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show system library' })).toBeVisible();
    await page.getByRole('button', { name: 'Show system library' }).click();
    await expect(page.getByRole('complementary', { name: 'Game Design System library' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Game Design System', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close system library' }).click({ position: { x: 320, y: 20 } });
    await expectNoDocumentOverflow(page);
  });

  test('completes a queued job through Cron without an accepting request instance', async ({ request }) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) throw new Error('CRON_SECRET is required for durable worker acceptance.');
    cronJobId = crypto.randomUUID();
    const cronTitle = `Cron Tactical Rules ${Date.now()}`;
    const input = {
      title: cronTitle,
      genres: ['Strategy'],
      philosophies: ['Readable Systems'],
      description: 'Create compact tactical rules with explicit costs and counterplay.',
      suitableFor: 'Single-player tactical games',
      sourceSnapshots: [],
      referenceGames: [],
      artStyle: mockArtStyle({ direction: '', referenceGames: [], avoid: '' }),
    };
    const { error: insertError } = await admin.from('game_design_system_generation_jobs').insert({
      id: cronJobId,
      owner_id: owner.id,
      status: 'queued',
      phase: 'collecting',
      input,
      idempotency_key: `cron-e2e-${crypto.randomUUID()}`,
      input_hash: 'c'.repeat(64),
      available_at: new Date(Date.now() - 1000).toISOString(),
    });
    if (insertError) throw insertError;

    const response = await request.get('/api/internal/game-design-system-worker', {
      headers: { Authorization: `Bearer ${cronSecret}` },
      timeout: 240_000,
    });
    const responseText = await response.text();
    expect(response.ok(), `Cron returned ${response.status()}: ${responseText}`).toBe(true);
    const payload = JSON.parse(responseText) as {
      results: Array<{ claimed: boolean; jobId?: string; status?: string }>;
    };
    expect(payload.results).toContainEqual(expect.objectContaining({
      claimed: true,
      jobId: cronJobId,
      status: 'completed',
    }));

    const { data: completedJob, error: jobError } = await admin.from('game_design_system_generation_jobs')
      .select('status,phase,design_system_id,output_version_id,attempt_count')
      .eq('id', cronJobId).single();
    if (jobError || !completedJob) throw jobError ?? new Error('Cron job was not persisted.');
    expect(completedJob).toMatchObject({ status: 'completed', phase: 'completed', attempt_count: 1 });
    expect(completedJob.design_system_id).toBeTruthy();
    expect(completedJob.output_version_id).toBeTruthy();
    cronSystemId = completedJob.design_system_id;

    const { data: version, error: versionError } = await admin.from('game_design_system_versions')
      .select('system_id,version_number,rendered_markdown,generation_job_id')
      .eq('id', completedJob.output_version_id).single();
    if (versionError || !version) throw versionError ?? new Error('Cron output version was not saved.');
    expect(version).toMatchObject({
      system_id: cronSystemId,
      version_number: 1,
      generation_job_id: cronJobId,
    });
    expect(version.rendered_markdown).toContain('> Version: 1');
    expect(version.rendered_markdown).not.toContain('__GDS_VERSION__');
  });

  test('generates from real sources, versions rules, and binds the selected version', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const pixelLabRequests: string[] = [];
    page.on('request', (request) => {
      if (/pixellab/i.test(request.url())) pixelLabRequests.push(request.url());
    });
    const login = new LoginPage(page);
    await login.goto();
    await login.login(owner);
    await login.expectLoginSuccess();

    await page.goto('/game-design-systems');
    await expect(page.getByRole('heading', { name: 'Game Design System', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /Official/ }).click();
    await expect(page.getByText('No official systems yet.', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /My Systems/ }).click();

    const title = `E2E Tactical Rules ${Date.now()}`;
    const startUrl = page.url();
    await page.getByRole('button', { name: 'Create Game Design System' }).click();
    await expect(page).toHaveURL(startUrl);
    await page.getByLabel('System name').fill(title);
    await page.getByRole('button', { name: 'RPG', exact: true }).click();
    await page.getByRole('button', { name: 'Meaningful Decisions', exact: true }).click();
    await page.getByLabel('Natural language description').fill('Create compact tactical rules with readable costs, reversible onboarding, and explicit counterplay.');
    await expect(page.getByRole('tablist', { name: 'Creation stages' }).getByRole('tab')).toHaveCount(4);
    expect(await page.getByRole('tablist', { name: 'Creation stages' }).getByRole('tab').evaluateAll((tabs) =>
      tabs.map((tab) => tab.getAttribute('aria-label')),
    )).toEqual(['Foundation', 'Art Style', 'Sources', 'Review']);
    await page.getByRole('button', { name: 'Continue to art style' }).click();
    await expect(page.getByRole('tab', { name: 'Art Style' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('radio', { name: 'Pixel Art, selected and locked' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Pixel Art, selected and locked' })).toBeDisabled();
    await expectLoadedArtStyleImages(page);
    const desktopCatalog = await page.getByLabel('Art style catalog').boundingBox();
    const desktopPreview = await page.getByRole('region', { name: 'Pixel Art preview' }).boundingBox();
    expect(desktopCatalog).not.toBeNull();
    expect(desktopPreview).not.toBeNull();
    expect(desktopCatalog!.x + desktopCatalog!.width).toBeLessThanOrEqual(desktopPreview!.x);
    await page.getByLabel('Custom art direction').fill(ART_DIRECTION);
    await page.getByRole('button', { name: 'Add visual reference' }).click();
    await page.getByLabel('Visual reference game 1').fill(VISUAL_REFERENCE_NAME);
    await page.getByLabel('What to borrow 1').fill(VISUAL_REFERENCE_BORROW);
    await page.getByLabel('Visual avoid guidance').fill(ART_AVOID);
    await resetViewportScroll(page);
    await expectNoVisibleTextOverflow(page.getByRole('region', { name: 'Pixel Art preview' }));
    await expectNoDocumentOverflow(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'create-art-style-1440x1000.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await resetViewportScroll(page);
    await expectLoadedArtStyleImages(page);
    const narrowOrder = await page.locator('[aria-label="Art style catalog"], [aria-label="Pixel Art preview"], #gds-art-direction').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-label') || element.id),
    );
    expect(narrowOrder).toEqual(['Art style catalog', 'Pixel Art preview', 'gds-art-direction']);
    const narrowCatalog = await page.getByLabel('Art style catalog').boundingBox();
    const narrowPreview = await page.getByRole('region', { name: 'Pixel Art preview' }).boundingBox();
    const narrowDirection = await page.getByLabel('Custom art direction').boundingBox();
    expect(narrowCatalog).not.toBeNull();
    expect(narrowPreview).not.toBeNull();
    expect(narrowDirection).not.toBeNull();
    expect(narrowCatalog!.y + narrowCatalog!.height).toBeLessThanOrEqual(narrowPreview!.y);
    expect(narrowPreview!.y + narrowPreview!.height).toBeLessThanOrEqual(narrowDirection!.y);
    await expectNoVisibleTextOverflow(page.getByRole('region', { name: 'Pixel Art preview' }));
    await expectNoDocumentOverflow(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'create-art-style-390x844.png'), fullPage: true });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Continue to sources' }).click();
    await page.getByLabel('Source project').selectOption(projectId);
    await page.getByRole('checkbox', { name: new RegExp(documentName) }).check();
    await page.getByRole('checkbox', { name: new RegExp(libraryName) }).check();
    await page.getByRole('button', { name: 'Review input' }).click();
    const artStyleSummary = page.getByLabel('Art Style summary');
    await expect(artStyleSummary).toContainText('Pixel Art');
    await expect(artStyleSummary).toContainText('Revision 1');
    await expect(artStyleSummary).toContainText(ART_DIRECTION);
    await expect(artStyleSummary).toContainText(`${VISUAL_REFERENCE_NAME}: ${VISUAL_REFERENCE_BORROW}`);
    await expect(artStyleSummary).toContainText(ART_AVOID);
    const generationRequestPromise = page.waitForRequest((request) =>
      request.method() === 'POST' && new URL(request.url()).pathname === '/api/game-design-systems/generation-jobs',
    );
    await page.getByRole('button', { name: 'Generate system' }).click();
    const generationRequest = await generationRequestPromise;
    const generationPayload = generationRequest.postDataJSON() as Record<string, unknown> & {
      artStyle: Record<string, unknown>;
    };
    expect(generationPayload.artStyle).toEqual({
      presetId: 'pixel-art',
      presetVersion: 1,
      customization: {
        direction: ART_DIRECTION,
        referenceGames: [{ name: VISUAL_REFERENCE_NAME, borrow: VISUAL_REFERENCE_BORROW }],
        avoid: ART_AVOID,
      },
    });
    expect(generationPayload.artStyle).not.toHaveProperty('specification');
    expect(generationPayload.artStyle).not.toHaveProperty('previewAssetSet');

    await expect(page.getByRole('heading', { name: /Generating|Generation incomplete/ })).toBeVisible();
    await Promise.race([
      page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible', timeout: 240_000 }),
      page.getByRole('heading', { name: 'Generation incomplete' }).waitFor({ state: 'visible', timeout: 240_000 }).then(async () => {
        throw new Error(`Generation failed: ${await page.locator('main').innerText()}`);
      }),
    ]);
    await expect(page).toHaveURL(startUrl);
    const { data: generatedSystem, error: generatedSystemError } = await admin.from('game_design_systems')
      .select('id').eq('owner_id', owner.id).eq('title', title).single();
    if (generatedSystemError || !generatedSystem) throw generatedSystemError ?? new Error('Generated system was not found.');
    systemId = generatedSystem.id;
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Design document', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Art Style' }).click();
    const workspaceArtStyle = page.getByRole('region', { name: 'Pixel Art preview' });
    await expectLoadedArtStyleImages(page);
    await expect(workspaceArtStyle).toContainText(ART_DIRECTION);
    await expect(workspaceArtStyle).toContainText(VISUAL_REFERENCE_NAME);
    await expect(workspaceArtStyle).toContainText(VISUAL_REFERENCE_BORROW);
    await expect(workspaceArtStyle).toContainText(ART_AVOID);
    await expectNoVisibleTextOverflow(workspaceArtStyle);
    await expectNoDocumentOverflow(page);
    await resetViewportScroll(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'workspace-art-style-1440x1000.png'), fullPage: true });
    await page.getByRole('img', { name: PIXEL_ART_V1_PRESET.previewAssetSet.character.alt }).evaluate((image) => {
      image.dispatchEvent(new Event('error'));
    });
    await expect(page.getByRole('status', { name: new RegExp(`Character preview unavailable.*${PIXEL_ART_V1_PRESET.previewAssetSet.character.alt}`) })).toBeVisible();
    await expect(page.getByRole('img', { name: PIXEL_ART_V1_PRESET.previewAssetSet.map.alt })).toBeVisible();
    await expect(workspaceArtStyle).toContainText(ART_DIRECTION);
    await page.getByRole('tab', { name: 'Sources' }).click();
    await expect(page.getByText(documentName, { exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: /Version 1/ })).toBeAttached();

    const { data: firstSystem, error: firstSystemError } = await admin.from('game_design_systems')
      .select('current_version_id').eq('id', systemId!).single();
    if (firstSystemError || !firstSystem?.current_version_id) throw firstSystemError ?? new Error('Generated system has no version.');
    const { data: firstVersion, error: firstVersionError } = await admin.from('game_design_system_versions')
      .select('id,document,rules,art_style,rendered_markdown,source_snapshots').eq('id', firstSystem.current_version_id).single();
    if (firstVersionError || !firstVersion) throw firstVersionError ?? new Error('Generated version was not found.');
    const snapshots = firstVersion.source_snapshots as Array<{ kind: string; label: string; excerpt: string; contentHash: string }>;
    expect(snapshots).toHaveLength(2);
    expect(snapshots.find((snapshot) => snapshot.kind === 'document')?.excerpt).toContain(DOCUMENT_CONSTRAINT);
    expect(snapshots.find((snapshot) => snapshot.kind === 'table')?.excerpt).toContain(TABLE_ROW_VALUE);
    expect(snapshots.every((snapshot) => /^[a-f0-9]{64}$/.test(snapshot.contentHash))).toBe(true);
    expect(firstVersion.document).toEqual(expect.objectContaining({
      designIntent: expect.any(String),
      playerFantasy: expect.any(String),
      coreLoop: expect.any(String),
    }));
    expect((firstVersion.document as { designIntent: string }).designIntent.length).toBeGreaterThan(0);
    expect(firstVersion.art_style).toEqual(expect.objectContaining({
      presetId: 'pixel-art',
      presetVersion: 1,
      title: 'Pixel Art',
      customization: {
        direction: ART_DIRECTION,
        referenceGames: [{ name: VISUAL_REFERENCE_NAME, borrow: VISUAL_REFERENCE_BORROW }],
        avoid: ART_AVOID,
      },
    }));
    expect(firstVersion.rendered_markdown).not.toContain(ART_DIRECTION);
    expect(firstVersion.rendered_markdown).not.toContain(VISUAL_REFERENCE_BORROW);
    expect(firstVersion.rendered_markdown).not.toContain(ART_AVOID);

    const editedRules = firstVersion.rules as GameDesignRuleSet;
    await page.getByRole('tab', { name: 'Rules' }).click();
    await page.getByRole('button', { name: 'New version' }).click();
    const ruleStatement = page.getByLabel('Rule statement');
    await ruleStatement.fill(`${editedRules.rules[0].statement} Preserve the original cost signal.`);
    await page.getByRole('button', { name: 'Review changes' }).click();
    await page.getByRole('button', { name: 'Create version' }).click();
    await expect(page.getByText('Version 2 created.', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('option', { name: /Version 2/ })).toBeAttached();

    await page.getByRole('tab', { name: 'Projects' }).click();
    const projectSelect = page.getByLabel('Select project');
    await projectSelect.selectOption(projectId);
    await page.getByRole('button', { name: 'Use version 2', exact: true }).click();
    await expect(page.getByText('Version 2 applied to project.', { exact: true })).toBeVisible();

    const { data: binding, error: bindingError } = await admin.from('project_game_design_systems')
      .select('design_system_id,version_id').eq('project_id', projectId).single();
    if (bindingError || !binding) throw bindingError ?? new Error('Project binding was not saved.');
    expect(binding.design_system_id).toBe(systemId);
    expect(binding.version_id).not.toBe(firstVersion.id);

    const { data: boundVersion, error: boundVersionError } = await admin.from('game_design_system_versions')
      .select('id,rules,art_style,parent_version_id,diff,conflicts').eq('id', binding.version_id).single();
    if (boundVersionError || !boundVersion) throw boundVersionError ?? new Error('Bound version was not found.');
    expect(boundVersion.parent_version_id).toBe(firstVersion.id);
    expect(boundVersion.art_style).toEqual(firstVersion.art_style);
    expect((boundVersion.conflicts as unknown[])).toHaveLength(0);
    expect((boundVersion.diff as { changed: string[] }).changed).toContain(editedRules.rules[0].id);

    const ownerClient = await createAuthenticatedClient(owner);
    const boundSystemMessage = await buildAgentSystemMessage({
      userId: owner.id,
      projectId,
      conversationId: 'game-design-system-e2e',
      supabase: ownerClient,
      userRole: 'admin',
    });
    expect(boundSystemMessage.content).toContain('pinned to Game Design System version 2');
    expect(boundSystemMessage.content).toContain(editedRules.rules[0].id);
    expect(boundSystemMessage.content).not.toContain('"source_snapshots"');
    expect(boundSystemMessage.content).not.toContain('"excerpt"');
    expect(boundSystemMessage.content).not.toContain(ART_DIRECTION);
    expect(boundSystemMessage.content).not.toContain(VISUAL_REFERENCE_BORROW);
    expect(boundSystemMessage.content).not.toContain(ART_AVOID);
    for (const snapshot of snapshots) expect(boundSystemMessage.content).not.toContain(snapshot.contentHash);

    await page.getByRole('tab', { name: 'Rules' }).click();
    await page.getByRole('button', { name: 'New version' }).click();
    await ruleStatement.fill(`${await ruleStatement.inputValue()} ${VERSION_THREE_ONLY}`);
    await page.getByRole('button', { name: 'Review changes' }).click();
    await page.getByRole('button', { name: 'Create version' }).click();
    await expect(page.getByText('Version 3 created.', { exact: true })).toBeVisible({ timeout: 30_000 });

    const { data: pinnedBinding, error: pinnedBindingError } = await admin.from('project_game_design_systems')
      .select('version_id').eq('project_id', projectId).single();
    if (pinnedBindingError || !pinnedBinding) throw pinnedBindingError ?? new Error('Pinned binding disappeared.');
    expect(pinnedBinding.version_id).toBe(boundVersion.id);

    const afterNewVersionMessage = await buildAgentSystemMessage({
      userId: owner.id,
      projectId,
      conversationId: 'game-design-system-e2e-after-v3',
      supabase: ownerClient,
      userRole: 'admin',
    });
    expect(afterNewVersionMessage.content).toContain('pinned to Game Design System version 2');
    expect(afterNewVersionMessage.content).not.toContain(VERSION_THREE_ONLY);
    expect(afterNewVersionMessage.content).not.toContain(ART_DIRECTION);
    expect(afterNewVersionMessage.content).not.toContain(VISUAL_REFERENCE_BORROW);
    expect(afterNewVersionMessage.content).not.toContain(ART_AVOID);

    const { error: viewerBindingError } = await admin.from('project_game_design_systems').insert({
      project_id: viewerProjectId,
      design_system_id: systemId,
      version_id: boundVersion.id,
      applied_by: viewer.id,
    });
    if (viewerBindingError) throw viewerBindingError;

    await page.setViewportSize({ width: 390, height: 844 });
    const versionSelect = page.getByRole('combobox', { name: 'Version' });
    await versionSelect.selectOption(firstVersion.id);
    await page.getByRole('tab', { name: 'Art Style' }).click();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelectorAll<HTMLElement>('[class*="detail"]').forEach((element) => {
        element.scrollTop = 0;
      });
    });
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(versionSelect).toHaveValue(firstVersion.id);
    await expect(versionSelect.locator('option:checked')).toHaveText('Version 1');
    const workspaceTabs = page.getByRole('tablist', { name: 'Game Design System views' });
    expect(await workspaceTabs.getByRole('tab').allTextContents()).toEqual([
      'Overview', 'Art Style', 'Rules', 'Versions', 'Sources', 'Projects',
    ]);
    await expect(page.getByRole('tab', { name: 'Art Style' })).toHaveAttribute('aria-selected', 'true');
    await expectLoadedArtStyleImages(page);
    await expectNoVisibleTextOverflow(page.getByRole('region', { name: 'Pixel Art preview' }));
    await expectNoDocumentOverflow(page);
    await expectScrollableSingleLineTabRail(workspaceTabs);
    await resetViewportScroll(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'workspace-art-style-390x844.png'), fullPage: true });

    const legacyTitle = `Legacy Tactical Rules ${Date.now()}`;
    const legacyResponse = await page.request.post('/api/game-design-systems', {
      data: { title: legacyTitle, rules: LEGACY_RULES },
    });
    expect(legacyResponse.ok(), await legacyResponse.text()).toBe(true);
    const legacyPayload = await legacyResponse.json() as { system: { id: string } };
    legacySystemId = legacyPayload.system.id;
    await page.goto(`/game-design-systems?systemId=${encodeURIComponent(legacySystemId)}`);
    await expect(page.getByRole('heading', { name: legacyTitle, exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Art Style' }).click();
    await expect(page.getByText('No art style specified', { exact: true })).toBeVisible();
    await expectNoDocumentOverflow(page);
    expect(pixelLabRequests).toEqual([]);
  });

  test('redacts source excerpts when a bound-system viewer cannot read the source project', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(viewer);
    await login.expectLoginSuccess();

    const response = await page.request.get(`/api/game-design-systems/${systemId}`);
    expect(response.ok()).toBe(true);
    const payload = await response.json() as {
      system: { current_version: { source_snapshots: Array<{ label: string; excerpt?: string; contentHash: string }> } };
    };
    expect(payload.system.current_version.source_snapshots).toHaveLength(2);
    expect(payload.system.current_version.source_snapshots.map((snapshot) => snapshot.label)).toEqual(
      expect.arrayContaining([documentName, libraryName]),
    );
    expect(payload.system.current_version.source_snapshots.every((snapshot) => snapshot.excerpt === undefined)).toBe(true);
    expect(payload.system.current_version.source_snapshots.every((snapshot) => /^[a-f0-9]{64}$/.test(snapshot.contentHash))).toBe(true);
  });

  test('shows failed and scheduled retry states', async ({ page }) => {
    const pixelLabRequests: string[] = [];
    page.on('request', (request) => {
      if (/pixellab/i.test(request.url())) pixelLabRequests.push(request.url());
    });
    const login = new LoginPage(page);
    await login.goto();
    await login.login(owner);
    await login.expectLoginSuccess();

    const failedJob = {
      id: 'e2e-failed-job',
      owner_id: owner.id,
      status: 'failed',
      phase: 'failed',
      error: 'DeepSeek temporarily unavailable.',
      attempt_count: 1,
      max_attempts: 3,
      available_at: new Date(Date.now() + 60_000).toISOString(),
    };
    await page.route('**/api/game-design-systems/generation-jobs', async (route) => {
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: failedJob }) });
    });
    await page.route('**/api/game-design-systems/generation-jobs/e2e-failed-job/retry', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job: {
          ...failedJob,
          status: 'queued',
          phase: 'collecting',
          error: null,
          attempt_count: 1,
          available_at: new Date(Date.now() + 60_000).toISOString(),
        } }),
      });
    });

    await page.goto('/game-design-systems/create');
    await page.getByLabel('System name').fill('Retry state rules');
    await page.getByRole('button', { name: 'RPG', exact: true }).click();
    await page.getByRole('button', { name: 'Continue to art style' }).click();
    await page.getByLabel('Custom art direction').fill(ART_DIRECTION);
    await page.getByRole('button', { name: 'Add visual reference' }).click();
    await page.getByLabel('Visual reference game 1').fill(VISUAL_REFERENCE_NAME);
    await page.getByLabel('What to borrow 1').fill(VISUAL_REFERENCE_BORROW);
    await page.getByLabel('Visual avoid guidance').fill(ART_AVOID);
    await page.getByRole('button', { name: 'Continue to sources' }).click();
    await page.getByRole('button', { name: 'Review input' }).click();
    await page.getByRole('button', { name: 'Generate system' }).click();
    await expect(page.getByRole('heading', { name: 'Generation incomplete' })).toBeVisible();
    await expect(page.getByText('DeepSeek temporarily unavailable.')).toBeVisible();
    await page.getByRole('button', { name: 'Back to sources' }).click();
    await page.getByRole('tab', { name: 'Art Style' }).click();
    await expect(page.getByLabel('Custom art direction')).toHaveValue(ART_DIRECTION);
    await expect(page.getByLabel('Visual reference game 1')).toHaveValue(VISUAL_REFERENCE_NAME);
    await expect(page.getByLabel('What to borrow 1')).toHaveValue(VISUAL_REFERENCE_BORROW);
    await expect(page.getByLabel('Visual avoid guidance')).toHaveValue(ART_AVOID);
    await page.getByRole('button', { name: 'Continue to sources' }).click();
    await page.getByRole('button', { name: 'Review input' }).click();
    await page.getByRole('button', { name: 'Generate system' }).click();
    await expect(page.getByRole('heading', { name: 'Generation incomplete' })).toBeVisible();
    await page.getByRole('button', { name: /Retry job/ }).click();
    await expect(page.getByRole('heading', { name: 'Generating Game Design System' })).toBeVisible();
    await expect(page.getByText(/Attempt 1 \/ 3.*retrying at/)).toBeVisible();
    expect(pixelLabRequests).toEqual([]);
  });
});
