import { mkdir } from 'node:fs/promises';
import process from 'node:process';
import { chromium } from '@playwright/test';
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { validateMapPlanV3 } from '../src/features/create-map/model/directMapSchema';

dotenv.config({ path: '.env.local', override: false, quiet: true });

const APP_URL = (process.env.KECO_ACCEPTANCE_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.KECO_ACCEPTANCE_EMAIL ?? '';
const PASSWORD = process.env.KECO_ACCEPTANCE_PASSWORD ?? '';
const MAP_ID = process.env.KECO_ACCEPTANCE_V3_MAP_ID ?? '';
const SCREENSHOT = 'test-results/create-map-v3-paid-acceptance.png';
const FAILURE_SCREENSHOT = 'test-results/create-map-v3-browser-failure.png';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  if (!supabaseUrl || !anonKey) throw new Error('supabase_not_configured');
  if (!EMAIL) throw new Error('acceptance_email_required');
  if (!UUID.test(MAP_ID)) throw new Error('authoritative_v3_map_required');

  let authCookies: Array<{ name: string; value: string }> = [];
  const supabase = createBrowserClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => authCookies,
      setAll: (next) => {
        const values = new Map(authCookies.map((cookie) => [cookie.name, cookie.value]));
        next.forEach((cookie) => values.set(cookie.name, cookie.value));
        authCookies = [...values].map(([name, value]) => ({ name, value }));
      },
    },
  });
  const authenticate = async () => {
    if (PASSWORD) return supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    if (!serviceRoleKey) throw new Error('acceptance_credentials_required');
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) throw new Error('acceptance_session_link_failed');
    return supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  };
  const { data: auth, error: authError } = await authenticate();
  if (authError || !auth.session) throw new Error('browser_authentication_failed');

  const { data: map, error: mapError } = await supabase.from('map_projects')
    .select('id,name,current_revision_id').eq('id', MAP_ID).single();
  if (mapError || !map?.current_revision_id) throw new Error('acceptance_map_not_found');
  const { data: revision, error: revisionError } = await supabase.from('map_revisions')
    .select('schema_version,plan,scene').eq('id', map.current_revision_id).eq('schema_version', 3).single();
  const parsedPlan = validateMapPlanV3(revision?.plan);
  if (revisionError || parsedPlan.success === false || !revision?.scene?.mapImage) {
    throw new Error('restorable_v3_revision_not_found');
  }
  const plan = parsedPlan.data;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addCookies(authCookies.filter((cookie) => cookie.value).map((cookie) => ({
    ...cookie,
    url: APP_URL,
  })));
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const responseFailures: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const resourceType = request.resourceType();
    if (resourceType === 'document' || resourceType === 'script' || resourceType === 'fetch') {
      requestFailures.push(`${resourceType}:${request.failure()?.errorText ?? 'unknown'}:${request.url()}`);
    }
  });
  page.on('response', (response) => {
    const resourceType = response.request().resourceType();
    if (
      response.status() >= 400
      && (resourceType === 'document' || resourceType === 'script' || resourceType === 'fetch')
    ) {
      responseFailures.push(`${resourceType}:${response.status()}:${response.url()}`);
    }
  });

  try {
    const response = await page.goto(`${APP_URL}/create-map`, { waitUntil: 'domcontentloaded' });
    try {
      await page.getByTestId('create-map-workbench').waitFor({ state: 'visible', timeout: 30_000 });
      const savedMaps = page.locator('section[aria-labelledby="saved-maps-heading"]');
      await savedMaps.getByText('Loading maps...').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined);
      await savedMaps.getByRole('button').filter({ hasText: map.name }).first().click();
      const workbench = page.getByTestId('create-map-workbench');
      await workbench.locator('h2').filter({ hasText: map.name }).waitFor({ state: 'visible', timeout: 30_000 });
      if (await workbench.getAttribute('data-schema-version') !== '3') throw new Error('saved_map_schema_not_v3');
      await page.getByText('All changes saved', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
      await page.getByText('Map ready', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
      const image = page.getByRole('img', { name: map.name });
      await image.waitFor({ state: 'visible', timeout: 30_000 });
      const naturalDimensions = await image.evaluate((element: HTMLImageElement) => ({
        width: element.naturalWidth,
        height: element.naturalHeight,
      }));
      if (naturalDimensions.width !== plan.map.width || naturalDimensions.height !== plan.map.height) {
        throw new Error('restored_image_dimensions_mismatch');
      }
      await mkdir('test-results', { recursive: true });
      await page.screenshot({ path: SCREENSHOT, fullPage: true });
      const stats = await sharp(SCREENSHOT).stats();
      const channelDeviation = stats.channels.slice(0, 3).map((channel) => channel.stdev);
      if (channelDeviation.every((value) => value < 5)) throw new Error('browser_screenshot_is_visually_blank');
      if (pageErrors.length > 0) throw new Error(`browser_page_errors:${pageErrors.join(',')}`);
      if (requestFailures.length > 0) throw new Error(`browser_request_failures:${requestFailures.join(',')}`);
      if (responseFailures.length > 0) throw new Error(`browser_response_failures:${responseFailures.join(',')}`);

      process.stdout.write(`${JSON.stringify({
        authenticated: true,
        mapId: MAP_ID,
        mapName: map.name,
        schemaVersion: 3,
        saveStatus: 'All changes saved',
        generationStatus: 'Map ready',
        naturalDimensions,
        screenshot: SCREENSHOT,
        screenshotChannelDeviation: channelDeviation.map((value) => Number(value.toFixed(2))),
        pageErrors: 0,
        failedDocumentScriptFetchRequests: 0,
      }, null, 2)}\n`);
    } catch (error) {
      await mkdir('test-results', { recursive: true });
      await page.screenshot({ path: FAILURE_SCREENSHOT, fullPage: true });
      throw new Error(JSON.stringify({
        code: error instanceof Error ? error.message : 'saved_map_did_not_restore',
        status: response?.status() ?? null,
        pathname: new URL(page.url()).pathname,
        pageErrors,
        requestFailures: requestFailures.slice(0, 5),
        responseFailures: responseFailures.slice(0, 5),
        screenshot: FAILURE_SCREENSHOT,
      }));
    }
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    error: error instanceof Error ? error.message : 'browser_acceptance_failed',
  })}\n`);
  process.exitCode = 1;
});
