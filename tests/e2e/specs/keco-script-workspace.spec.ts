import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LoginPage } from '../pages/login.page';
import {
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

/**
 * Keco Script workspace E2E smoke (seeded path).
 *
 * Prefer this over Generate conversation — LLM/import generate is flaky in CI.
 * Seeds: Studio document → script_workspace_documents membership → document-derived
 * script library (Label/Name/Content + Option0_Next) → open split VN + Flow chart.
 *
 * Run:
 *   npx playwright test tests/e2e/specs/keco-script-workspace.spec.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (see .env.local)
 * and migration `script_workspace_documents` applied on the target DB.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasE2EAdmin =
  Boolean(supabaseUrl) &&
  Boolean(serviceRoleKey) &&
  !supabaseUrl!.includes('example.supabase.co') &&
  !/dummy/i.test(serviceRoleKey ?? '');

const DOCUMENT_MARKDOWN = '# Script smoke\n\nGuide: Welcome.\nHero: Ready.\n';
const LIBRARY_NAME_PREFIX = 'Script workspace smoke';

type SmokeFixture = {
  projectId: string;
  documentId: string;
  libraryId: string;
  libraryName: string;
  owner: TemporaryUser;
};

async function createDocumentFixture(
  admin: SupabaseClient,
  projectId: string,
  ownerId: string,
  name: string
): Promise<string> {
  const { data, error } = await admin
    .from('documents')
    .insert({
      project_id: projectId,
      folder_id: null,
      name,
      content: DOCUMENT_MARKDOWN,
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Failed to create document fixture');
  return data.id as string;
}

async function seedWorkspaceMembership(
  admin: SupabaseClient,
  projectId: string,
  documentId: string,
  importedBy: string
): Promise<void> {
  const { error } = await admin.from('script_workspace_documents').insert({
    project_id: projectId,
    document_id: documentId,
    imported_by: importedBy,
  });
  if (error) throw error;
}

async function seedScriptDerivedLibrary(
  admin: SupabaseClient,
  input: {
    projectId: string;
    documentId: string;
    libraryName: string;
  }
): Promise<string> {
  const { data: library, error: libraryError } = await admin
    .from('libraries')
    .insert({
      project_id: input.projectId,
      folder_id: null,
      name: input.libraryName,
      description: 'Keco Script E2E seeded derived script',
      source_document_id: input.documentId,
      document_export_type: 'script',
    })
    .select('id')
    .single();
  if (libraryError || !library) {
    throw libraryError ?? new Error('Failed to create derived script library');
  }

  const fieldLabels = [
    'Label',
    'Name',
    'Content',
    'Option0',
    'Option0_Next',
  ] as const;

  const { data: fields, error: fieldsError } = await admin
    .from('library_field_definitions')
    .insert(
      fieldLabels.map((label, orderIndex) => ({
        library_id: library.id,
        section_id: `${library.id}:Script`,
        section: 'Script',
        label,
        description: null,
        data_type: 'string',
        formula_expression: null,
        required: false,
        order_index: orderIndex,
        enum_options: null,
        reference_libraries: null,
      }))
    )
    .select('id, order_index');
  if (fieldsError || !fields) {
    throw fieldsError ?? new Error('Failed to create script field definitions');
  }

  const { data: assets, error: assetsError } = await admin
    .from('library_assets')
    .insert([
      { library_id: library.id, name: 'Start', row_index: 0 },
      { library_id: library.id, name: 'End', row_index: 1 },
    ])
    .select('id, row_index');
  if (assetsError || !assets) {
    throw assetsError ?? new Error('Failed to create script asset rows');
  }

  const fieldId = (orderIndex: number) =>
    fields.find((field) => field.order_index === orderIndex)!.id;
  const assetId = (rowIndex: number) =>
    assets.find((asset) => asset.row_index === rowIndex)!.id;

  const { error: valuesError } = await admin.from('library_asset_values').insert([
    { asset_id: assetId(0), field_id: fieldId(0), value_json: 'Start' },
    { asset_id: assetId(0), field_id: fieldId(1), value_json: 'Guide' },
    { asset_id: assetId(0), field_id: fieldId(2), value_json: 'Welcome to the city.' },
    { asset_id: assetId(0), field_id: fieldId(3), value_json: 'Continue' },
    { asset_id: assetId(0), field_id: fieldId(4), value_json: 'Jump End' },
    { asset_id: assetId(1), field_id: fieldId(0), value_json: 'End' },
    { asset_id: assetId(1), field_id: fieldId(1), value_json: 'Hero' },
    { asset_id: assetId(1), field_id: fieldId(2), value_json: 'I am ready.' },
  ]);
  if (valuesError) throw valuesError;

  return library.id as string;
}

async function loginAs(page: Page, user: TemporaryUser): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(user);
  await loginPage.expectLoginSuccess();
}

test.describe('Keco Script workspace smoke (seeded)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });
  test.skip(
    !hasE2EAdmin,
    'Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for DB fixtures'
  );

  let admin: SupabaseClient;
  let fixture: SmokeFixture;
  let ownerResource: TemporaryUser | undefined;
  let projectResourceId: string | undefined;

  test.beforeAll(async () => {
    admin = getE2EAdminClient();

    // Probe Task 2 migration before spending fixture setup time.
    const probe = await admin.from('script_workspace_documents').select('project_id').limit(1);
    if (probe.error) {
      throw new Error(
        `script_workspace_documents unavailable (${probe.error.message}). ` +
          'Apply supabase/migrations/20260731200000_script_workspace_documents.sql before running this smoke.'
      );
    }

    const owner = await createTemporaryUser(admin, 'script-workspace-smoke');
    ownerResource = owner;
    const projectId = await createProjectFixture(admin, owner.id, {
      addOwnerMembership: true,
    });
    projectResourceId = projectId;

    const documentId = await createDocumentFixture(
      admin,
      projectId,
      owner.id,
      `Smoke doc ${crypto.randomUUID().slice(0, 6)}`
    );
    await seedWorkspaceMembership(admin, projectId, documentId, owner.id);

    const libraryName = `${LIBRARY_NAME_PREFIX} ${crypto.randomUUID().slice(0, 6)}`;
    const libraryId = await seedScriptDerivedLibrary(admin, {
      projectId,
      documentId,
      libraryName,
    });

    fixture = { projectId, documentId, libraryId, libraryName, owner };
  });

  test.afterAll(async () => {
    if (projectResourceId) {
      try {
        await removeProjectFixture(admin, projectResourceId);
      } catch {
        // best-effort cleanup
      }
    }
    if (ownerResource) {
      try {
        await deleteTemporaryUser(admin, ownerResource);
      } catch {
        // best-effort cleanup
      }
    }
  });

  test('Import Documentation page shows Select form', async ({ page }) => {
    await loginAs(page, fixture.owner);
    await page.goto(`/script-system/${fixture.projectId}`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.getByRole('heading', { name: 'Import Documentation' })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByRole('region', { name: 'Select form' })).toBeVisible();
    await expect(page.getByText('Select form', { exact: true })).toBeVisible();
  });

  test('seeded script route shows VN pane, Flow chart, and library title', async ({
    page,
  }) => {
    await loginAs(page, fixture.owner);
    await page.goto(
      `/script-system/${fixture.projectId}/script/${fixture.libraryId}`,
      { waitUntil: 'domcontentloaded' }
    );

    // Library title lives in the Script sidebar tree (split view no longer renders an h1).
    await expect(
      page.locator('aside').locator(`[title="${fixture.libraryName}"]`)
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('complementary', { name: 'Flow chart' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Flow chart', level: 2 })).toBeVisible();

    // Plot-node VN pane (no player Restart toolbar). Branch title and dialogue can
    // share this copy, so target the branch chip to avoid Playwright strict mode.
    await expect(page.getByTestId('script-branch-name')).toHaveText('Welcome to the city.');
  });
});
