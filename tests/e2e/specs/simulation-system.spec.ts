import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LoginPage } from '../pages/login.page';
import { SimulationSystemPage } from '../pages/simulation-system.page';
import {
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

type SimulationLibraryNames = {
  characters: string;
  skills: string;
  level: string;
  skillCost: string;
};

type FixtureField = {
  label: string;
  dataType: 'string' | 'float';
};

async function dragMappingCard(page: Page, sourceName: string, targetSelector: string): Promise<void> {
  const source = page.getByRole('button', { name: `Drag ${sourceName}`, exact: true });
  const target = page.locator(targetSelector);
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  await source.waitFor({ state: 'visible' });
  await target.waitFor({ state: 'visible' });

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error(`Could not drag ${sourceName}: missing bounds`);

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}

async function createSimulationLibrary(
  admin: SupabaseClient,
  projectId: string,
  name: string,
  fields: readonly FixtureField[],
  rows: ReadonlyArray<{ name: string; values: Readonly<Record<string, unknown>> }>
): Promise<void> {
  const { data: library, error: libraryError } = await admin
    .from('libraries')
    .insert({ project_id: projectId, name, description: 'Simulation Playwright fixture' })
    .select('id')
    .single();
  if (libraryError || !library) {
    throw libraryError ?? new Error(`Failed to create ${name}`);
  }

  const sectionId = `${library.id}:Simulation`;
  const { data: createdFields, error: fieldsError } = await admin
    .from('library_field_definitions')
    .insert(fields.map((field, orderIndex) => ({
      library_id: library.id,
      section_id: sectionId,
      section: 'Simulation',
      label: field.label,
      data_type: field.dataType,
      order_index: orderIndex,
      required: false,
    })))
    .select('id, label');
  if (fieldsError || !createdFields) {
    throw fieldsError ?? new Error(`Failed to create fields for ${name}`);
  }

  const { data: createdRows, error: rowsError } = await admin
    .from('library_assets')
    .insert(rows.map((row, rowIndex) => ({
      library_id: library.id,
      name: row.name,
      row_index: rowIndex,
    })))
    .select('id, row_index');
  if (rowsError || !createdRows) {
    throw rowsError ?? new Error(`Failed to create rows for ${name}`);
  }

  const fieldIdByLabel = new Map(
    createdFields.map((field) => [field.label as string, field.id as string])
  );
  const rowIdByIndex = new Map(
    createdRows.map((row) => [row.row_index as number, row.id as string])
  );
  const values = rows.flatMap((row, rowIndex) =>
    Object.entries(row.values).map(([label, value]) => ({
      asset_id: rowIdByIndex.get(rowIndex)!,
      field_id: fieldIdByLabel.get(label)!,
      value_json: value,
    }))
  );
  const { error: valuesError } = await admin.from('library_asset_values').insert(values);
  if (valuesError) throw valuesError;
}

async function createSimulationFixtures(
  admin: SupabaseClient,
  projectId: string
): Promise<SimulationLibraryNames> {
  const suffix = crypto.randomUUID().slice(0, 6);
  const names = {
    characters: `E2E Characters ${suffix}`,
    skills: `E2E Skills ${suffix}`,
    level: `E2E Character curve ${suffix}`,
    skillCost: `E2E Skill curve ${suffix}`,
  };

  await Promise.all([
    createSimulationLibrary(admin, projectId, names.characters, [
      { label: 'id', dataType: 'string' },
      { label: 'name', dataType: 'string' },
      { label: 'element', dataType: 'string' },
      { label: 'class name', dataType: 'string' },
      { label: 'base hp', dataType: 'float' },
      { label: 'base atk', dataType: 'float' },
      { label: 'base def', dataType: 'float' },
      { label: 'base spd', dataType: 'float' },
      { label: 'base mp', dataType: 'float' },
    ], [
      { name: 'Ignara', values: { id: 'ignara', name: 'Ignara', element: 'Fire', 'class name': 'Mage', 'base hp': 520, 'base atk': 88, 'base def': 30, 'base spd': 42, 'base mp': 120 } },
      { name: 'Bramwell', values: { id: 'bramwell', name: 'Bramwell', element: 'Earth', 'class name': 'Guardian', 'base hp': 940, 'base atk': 62, 'base def': 78, 'base spd': 24, 'base mp': 60 } },
    ]),
    createSimulationLibrary(admin, projectId, names.skills, [
      { label: 'id', dataType: 'string' },
      { label: 'name', dataType: 'string' },
      { label: 'element', dataType: 'string' },
      { label: 'mp cost', dataType: 'float' },
      { label: 'power', dataType: 'float' },
      { label: 'cooldown', dataType: 'float' },
      { label: 'type', dataType: 'string' },
      { label: 'status', dataType: 'string' },
      { label: 'effect', dataType: 'string' },
    ], [
      { name: 'Fireball', values: { id: 'fireball', name: 'Fireball', element: 'Fire', 'mp cost': 20, power: 140, cooldown: 2, type: 'dmg', status: 'burn', effect: 'Burn damage' } },
    ]),
    createSimulationLibrary(admin, projectId, names.level, [
      { label: 'level', dataType: 'float' },
      { label: 'exp', dataType: 'float' },
      { label: 'sp', dataType: 'float' },
    ], [
      { name: 'Level 1', values: { level: 1, exp: 100, sp: 1 } },
      { name: 'Level 2', values: { level: 2, exp: 260, sp: 1 } },
    ]),
    createSimulationLibrary(admin, projectId, names.skillCost, [
      { label: 'skill id', dataType: 'string' },
      { label: 'skill level', dataType: 'float' },
      { label: 'upgrade sp', dataType: 'float' },
    ], [
      { name: 'Fireball level 1', values: { 'skill id': 'fireball', 'skill level': 1, 'upgrade sp': 1 } },
      { name: 'Fireball level 2', values: { 'skill id': 'fireball', 'skill level': 2, 'upgrade sp': 2 } },
    ]),
  ]);

  return names;
}

test.describe('Native simulation system', () => {
  test.describe.configure({ mode: 'serial', timeout: 180000 });

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId: string;
  let libraryNames: SimulationLibraryNames;

  async function login(page: Page): Promise<void> {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(owner);
    await login.expectLoginSuccess();
  }

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'simulation-owner');
    projectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });
    libraryNames = await createSimulationFixtures(admin, projectId);
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('imports Studio libraries, runs a battle, and restores the local session', async ({ page }) => {
    await login(page);
    const simulation = new SimulationSystemPage(page);
    await simulation.mockAiFieldMapping();
    await simulation.goto();
    await simulation.importLibraries(libraryNames);
    await simulation.configureTeamsAndSkills();
    await simulation.startBattleAndExpectRestoration();
  });

  test('reorders mapped fields and moves columns through the Unmapped pool', async ({ page }) => {
    await login(page);
    const simulation = new SimulationSystemPage(page);
    await simulation.mockAiFieldMapping();
    await simulation.goto();
    await simulation.selectLibrary('Characters', libraryNames.characters);

    // Character SIM field ids use `el` (not `element`); aria-labels use Studio column names.
    const nameSlot = page.locator('[data-mapping-drop="slot:name"]');
    const elementSlot = page.locator('[data-mapping-drop="slot:el"]');
    const unmapped = page.getByTestId('mapping-unmapped');
    await expect(nameSlot.getByRole('button', { name: 'Drag name' })).toBeVisible({ timeout: 30_000 });
    await expect(elementSlot.getByRole('button', { name: 'Drag element' })).toBeVisible();
    await expect(unmapped.getByRole('button', { name: 'Drag class name' })).toBeVisible();

    await dragMappingCard(page, 'element', '[data-mapping-drop="slot:name"]');
    await expect(nameSlot.getByRole('button', { name: 'Drag element' })).toBeVisible();
    await expect(elementSlot.getByRole('button', { name: 'Drag name' })).toBeVisible();

    await dragMappingCard(page, 'class name', '[data-mapping-drop="slot:el"]');
    await expect(elementSlot.getByRole('button', { name: 'Drag class name' })).toBeVisible();
    await expect(unmapped.getByRole('button', { name: 'Drag name' })).toBeVisible();

    await dragMappingCard(page, 'class name', '[data-mapping-drop="unmapped"]');
    await expect(elementSlot.getByText('Drop a source column', { exact: true })).toBeVisible();
    await expect(unmapped.getByRole('button', { name: 'Drag class name' })).toBeVisible();
  });

  test('keeps manual field mapping available when AI mapping fails', async ({ page }) => {
    await login(page);
    const simulation = new SimulationSystemPage(page);
    await page.route('**/api/simulation/field-mapping', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic mapping failure' }),
      });
    });
    await simulation.goto();
    await simulation.selectLibrary('Characters', libraryNames.characters);

    await expect(page.getByRole('alert')).toContainText('AI mapping failed - map manually', {
      timeout: 30_000,
    });
    const nameSlot = page.locator('[data-mapping-drop="slot:name"]');
    const unmapped = page.getByTestId('mapping-unmapped');
    await expect(unmapped.getByRole('button', { name: 'Drag name' })).toBeVisible();

    await dragMappingCard(page, 'name', '[data-mapping-drop="slot:name"]');
    await expect(nameSlot.getByRole('button', { name: 'Drag name' })).toBeVisible();
    await expect(unmapped.getByRole('button', { name: 'Drag name' })).toHaveCount(0);
  });
});
