import { test, type Page } from '@playwright/test';
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
    level: `E2E Level curve ${suffix}`,
    skillCost: `E2E Skill curve ${suffix}`,
  };

  await Promise.all([
    createSimulationLibrary(admin, projectId, names.characters, [
      { label: 'id', dataType: 'string' },
      { label: 'name', dataType: 'string' },
      { label: 'cls', dataType: 'string' },
      { label: 'el', dataType: 'string' },
      { label: 'hp', dataType: 'float' },
      { label: 'atk', dataType: 'float' },
      { label: 'def', dataType: 'float' },
      { label: 'spd', dataType: 'float' },
      { label: 'mp', dataType: 'float' },
    ], [
      { name: 'Ignara', values: { id: 'ignara', name: 'Ignara', cls: 'Fire Mage', el: 'Fire', hp: 520, atk: 88, def: 30, spd: 42, mp: 120 } },
      { name: 'Bramwell', values: { id: 'bramwell', name: 'Bramwell', cls: 'Earth Knight', el: 'Earth', hp: 940, atk: 62, def: 78, spd: 24, mp: 60 } },
    ]),
    createSimulationLibrary(admin, projectId, names.skills, [
      { label: 'id', dataType: 'string' },
      { label: 'name', dataType: 'string' },
      { label: 'el', dataType: 'string' },
      { label: 'mp', dataType: 'float' },
      { label: 'power', dataType: 'float' },
      { label: 'cd', dataType: 'float' },
      { label: 'kind', dataType: 'string' },
      { label: 'status', dataType: 'string' },
      { label: 'fx', dataType: 'string' },
    ], [
      { name: 'Fireball', values: { id: 'fireball', name: 'Fireball', el: 'Fire', mp: 20, power: 140, cd: 2, kind: 'dmg', status: 'burn', fx: 'Burn damage' } },
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
      { label: 'skillId', dataType: 'string' },
      { label: 'lv', dataType: 'float' },
      { label: 'cost', dataType: 'float' },
    ], [
      { name: 'Fireball level 1', values: { skillId: 'fireball', lv: 1, cost: 1 } },
      { name: 'Fireball level 2', values: { skillId: 'fireball', lv: 2, cost: 2 } },
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
});
