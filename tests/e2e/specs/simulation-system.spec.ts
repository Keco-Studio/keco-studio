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

test.describe('Native simulation system', () => {
  test.describe.configure({ mode: 'serial', timeout: 180000 });

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId: string;

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
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('runs the built-in demo battle and restores the local session', async ({ page }) => {
    await login(page);
    const simulation = new SimulationSystemPage(page);
    await simulation.goto();
    await simulation.useDemoData();
    await simulation.configureTeamsAndSkills();
    await simulation.startBattleAndExpectRestoration();
  });
});
