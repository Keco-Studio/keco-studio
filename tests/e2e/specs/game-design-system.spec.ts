import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildAgentSystemMessage } from '@/lib/agent/core';
import type { GameDesignRuleSet } from '@/lib/game-design-system/ruleSchema';
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

async function createAuthenticatedClient(user: TemporaryUser): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('E2E Supabase user environment is not configured.');
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}

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
  let cronSystemId: string | null = null;
  let cronJobId: string | null = null;

  test.beforeAll(async () => {
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
    if (cronSystemId) await admin.from('game_design_systems').delete().eq('id', cronSystemId);
    if (cronJobId) await admin.from('game_design_system_generation_jobs').delete().eq('id', cronJobId);
    if (viewer) await deleteTemporaryUser(admin, viewer).catch(() => undefined);
    if (owner) await deleteTemporaryUser(admin, owner).catch(() => undefined);
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
    const login = new LoginPage(page);
    await login.goto();
    await login.login(owner);
    await login.expectLoginSuccess();

    await page.goto('/game-design-systems');
    await expect(page.getByRole('heading', { name: 'Game Design System', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /官方预设/ }).click();
    await expect(page.getByRole('button', { name: /Tactical Systems/ })).toBeVisible();

    const title = `E2E Tactical Rules ${Date.now()}`;
    await page.getByRole('button', { name: /创建体系/ }).click();
    await page.getByLabel('体系名称').fill(title);
    await page.getByRole('button', { name: 'RPG', exact: true }).click();
    await page.getByRole('button', { name: 'Meaningful Decisions', exact: true }).click();
    await page.getByLabel('自然语言描述').fill('Create compact tactical rules with readable costs, reversible onboarding, and explicit counterplay.');
    await page.getByLabel('来源项目').selectOption(projectId);
    await page.getByRole('checkbox', { name: new RegExp(documentName) }).check();
    await page.getByRole('checkbox', { name: new RegExp(libraryName) }).check();
    await page.getByRole('button', { name: /生成体系/ }).first().click();

    await expect(page.getByRole('heading', { name: /正在生成|生成未完成/ })).toBeVisible();
    await Promise.race([
      page.waitForURL(/\/game-design-systems\?systemId=/, { timeout: 240_000 }),
      page.getByRole('heading', { name: '生成未完成' }).waitFor({ state: 'visible', timeout: 240_000 }).then(async () => {
        throw new Error(`Generation failed: ${await page.locator('main').innerText()}`);
      }),
    ]);
    systemId = new URL(page.url()).searchParams.get('systemId');
    expect(systemId).toBeTruthy();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByText(documentName, { exact: true })).toBeVisible();
    await expect(page.getByText(libraryName, { exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: /版本 1/ })).toBeAttached();

    const { data: firstSystem, error: firstSystemError } = await admin.from('game_design_systems')
      .select('current_version_id').eq('id', systemId!).single();
    if (firstSystemError || !firstSystem?.current_version_id) throw firstSystemError ?? new Error('Generated system has no version.');
    const { data: firstVersion, error: firstVersionError } = await admin.from('game_design_system_versions')
      .select('id,rules,source_snapshots').eq('id', firstSystem.current_version_id).single();
    if (firstVersionError || !firstVersion) throw firstVersionError ?? new Error('Generated version was not found.');
    const snapshots = firstVersion.source_snapshots as Array<{ kind: string; label: string; excerpt: string; contentHash: string }>;
    expect(snapshots).toHaveLength(2);
    expect(snapshots.find((snapshot) => snapshot.kind === 'document')?.excerpt).toContain(DOCUMENT_CONSTRAINT);
    expect(snapshots.find((snapshot) => snapshot.kind === 'table')?.excerpt).toContain(TABLE_ROW_VALUE);
    expect(snapshots.every((snapshot) => /^[a-f0-9]{64}$/.test(snapshot.contentHash))).toBe(true);

    await page.getByRole('button', { name: '编辑规则' }).click();
    const rulesEditor = page.getByLabel('规则 JSON');
    const editedRules = JSON.parse(await rulesEditor.inputValue()) as GameDesignRuleSet;
    editedRules.rules[0].statement = `${editedRules.rules[0].statement} Preserve the original cost signal.`;
    await rulesEditor.fill(JSON.stringify(editedRules, null, 2));
    await page.getByRole('button', { name: '创建新版本' }).click();
    await expect(page.getByText('版本 2 已创建。', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('option', { name: /版本 2/ })).toBeAttached();

    const projectSelect = page.getByLabel('选择项目');
    await projectSelect.selectOption(projectId);
    await page.getByRole('button', { name: '使用版本 2', exact: true }).click();
    await expect(page.getByText('已将版本 2 应用到项目。', { exact: true })).toBeVisible();

    const { data: binding, error: bindingError } = await admin.from('project_game_design_systems')
      .select('design_system_id,version_id').eq('project_id', projectId).single();
    if (bindingError || !binding) throw bindingError ?? new Error('Project binding was not saved.');
    expect(binding.design_system_id).toBe(systemId);
    expect(binding.version_id).not.toBe(firstVersion.id);

    const { data: boundVersion, error: boundVersionError } = await admin.from('game_design_system_versions')
      .select('id,rules,parent_version_id,diff,conflicts').eq('id', binding.version_id).single();
    if (boundVersionError || !boundVersion) throw boundVersionError ?? new Error('Bound version was not found.');
    expect(boundVersion.parent_version_id).toBe(firstVersion.id);
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
    expect(boundSystemMessage.content).not.toContain(DOCUMENT_CONSTRAINT);
    expect(boundSystemMessage.content).not.toContain(TABLE_ROW_VALUE);

    await page.getByRole('button', { name: '编辑规则' }).click();
    const versionThreeRules = JSON.parse(await rulesEditor.inputValue()) as GameDesignRuleSet;
    versionThreeRules.rules[0].statement = `${versionThreeRules.rules[0].statement} ${VERSION_THREE_ONLY}`;
    await rulesEditor.fill(JSON.stringify(versionThreeRules, null, 2));
    await page.getByRole('button', { name: '创建新版本' }).click();
    await expect(page.getByText('版本 3 已创建。', { exact: true })).toBeVisible({ timeout: 30_000 });

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

    const { error: viewerBindingError } = await admin.from('project_game_design_systems').insert({
      project_id: viewerProjectId,
      design_system_id: systemId,
      version_id: boundVersion.id,
      applied_by: viewer.id,
    });
    if (viewerBindingError) throw viewerBindingError;

    await page.screenshot({ path: 'test-results/game-design-system-real.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelectorAll<HTMLElement>('[class*="detail"]').forEach((element) => {
        element.scrollTop = 0;
      });
    });
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'test-results/game-design-system-real-mobile.png', fullPage: true });
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
    await page.getByLabel('体系名称').fill('Retry state rules');
    await page.getByRole('button', { name: 'RPG', exact: true }).click();
    await page.getByRole('button', { name: /生成体系/ }).first().click();
    await expect(page.getByRole('heading', { name: '生成未完成' })).toBeVisible();
    await expect(page.getByText('DeepSeek temporarily unavailable.')).toBeVisible();
    await page.getByRole('button', { name: /重试任务/ }).click();
    await expect(page.getByRole('heading', { name: '正在生成 Game Design System' })).toBeVisible();
    await expect(page.getByText(/第 1 \/ 3 次尝试.*后重试/)).toBeVisible();
  });
});
