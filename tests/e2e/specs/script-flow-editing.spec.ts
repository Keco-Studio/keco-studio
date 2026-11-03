import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { buildProjectFixture, teardownProjectFixture, TEST_PASSWORD, type ProjectFixture } from '../../unit/database/helpers/rlsTestClient';
import { LoginPage } from '../pages/login.page';
import { waitForSupabaseAuthStorage } from '../utils/auth-storage';

test.describe('Script flow editing on local Supabase', () => {
  let fx: ProjectFixture;
  test.beforeAll(async () => {
    if (!['localhost', '127.0.0.1'].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname)) throw new Error('Local database required');
    fx = await buildProjectFixture();
    const document = await fx.svc.from('documents').insert({ project_id: fx.projectId, name: 'Flow test source', created_by: fx.owner.id,
      content: `<BlockAnchor id="${randomUUID()}" />Opening\n\n<BlockAnchor id="${randomUUID()}" />Ending` }).select('id').single();
    expect(document.error).toBeNull();
    expect((await fx.svc.from('script_workspace_documents').insert({ project_id: fx.projectId, document_id: document.data.id, imported_by: fx.owner.id })).error).toBeNull();
    expect((await fx.svc.from('libraries').update({ source_document_id: document.data.id, document_export_type: 'script' }).eq('id', fx.libraryId)).error).toBeNull();
    const fields = ['Label', 'Type', 'Name', 'Content', 'Commands'];
    const schema = await fx.svc.from('library_field_definitions').insert(fields.map((label, i) => ({ library_id: fx.libraryId, section: '__keco_flat_fields__', section_id: `${fx.libraryId}:keco-flat-fields`, label, data_type: 'string', order_index: i }))).select('id,label');
    expect(schema.error).toBeNull();
    for (const [index, values] of [['A', '4', '', 'Opening', ''], ['B', '4', '', 'Ending', 'End']].entries()) {
      const row = await fx.svc.from('library_assets').insert({ library_id: fx.libraryId, name: '', row_index: index }).select('id').single();
      expect(row.error).toBeNull();
      expect((await fx.svc.from('library_asset_values').insert(values.map((value, i) => ({ asset_id: row.data.id, field_id: schema.data!.find(f => f.label === fields[i])!.id, value_json: value })))).error).toBeNull();
    }
  });
  test.afterAll(async () => { if (fx) await teardownProjectFixture(fx); });
  test('saves an ending, reloads the persisted Script, and preserves text', async ({ page }) => {
    test.setTimeout(240000);
    await page.route('**/api/script-plot-titles', route => route.fulfill({ json: { titles: {} } }));
    const login = new LoginPage(page);
    await login.goto(); await login.login({ email: fx.owner.email, password: TEST_PASSWORD });
    await waitForSupabaseAuthStorage(page);
    await page.goto(`/script-system/${fx.projectId}/script/${fx.libraryId}`);
    const loaded = page.waitForResponse(r => r.url().includes('/api/script-flow/') && r.request().method() === 'GET', { timeout: 120000 });
    await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
    expect((await loaded).status()).toBe(200);
    await expect(page.getByLabel('Source row')).toBeVisible();
    await page.getByLabel('Destination', { exact: true }).selectOption('end');
    const saved = page.waitForResponse(r => r.url().includes('/api/script-flow/') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save flow', exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(200);
    const endpoint = `/api/script-flow/${fx.projectId}/${fx.libraryId}`;
    const payload = savedResponse.request().postDataJSON();
    expect((await page.request.post(endpoint, { data: payload })).status()).toBe(200);
    expect((await page.request.post(endpoint, { data: { ...payload, requestId: randomUUID() } })).status()).toBe(409);
    const viewer = await fx.viewer.client.auth.signInWithPassword({ email: fx.viewer.email, password: TEST_PASSWORD });
    expect(viewer.error).toBeNull();
    const headers = { Authorization: `Bearer ${viewer.data.session!.access_token}` };
    expect((await page.request.post(endpoint, { headers, data: { ...payload, requestId: randomUUID() } })).status()).toBe(403);
    await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
    await expect(page.getByLabel('Destination', { exact: true })).toHaveValue('end');
    await expect(page.getByLabel('Source row')).toContainText('Opening');
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await page.screenshot({ path: '.superpowers/sdd/2026-11-03-script-flow-editing/flow-editor.png', fullPage: true });
  });
});
