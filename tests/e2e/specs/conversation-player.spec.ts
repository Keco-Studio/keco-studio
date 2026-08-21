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

type ConversationFixture = {
  documentId: string;
  libraryId: string;
  libraryName: string;
};

/** Script workspace flow graph reads these canonical labels from flowRows. */
const FIELD_LABELS = [
  'Label',
  'Type',
  'Name',
  'Content',
  'Commands',
  'Option0',
  'Option0_Next',
  'Option0_Commands',
  'Option1',
  'Option1_Next',
  'Option1_Commands',
] as const;

async function createConversationFixture(
  admin: SupabaseClient,
  projectId: string,
  ownerId: string
): Promise<ConversationFixture> {
  const suffix = crypto.randomUUID().slice(0, 6);
  const { data: document, error: documentError } = await admin
    .from('documents')
    .insert({
      project_id: projectId,
      folder_id: null,
      name: `Rainy manor ${suffix}`,
      content: '# Rainy manor\n\nA branching conversation fixture.',
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (documentError || !document) {
    throw documentError ?? new Error('Failed to create conversation source document');
  }

  const { error: membershipError } = await admin.from('script_workspace_documents').insert({
    project_id: projectId,
    document_id: document.id,
    imported_by: ownerId,
  });
  if (membershipError) throw membershipError;

  const libraryName = `Rainy manor Conversation ${suffix}`;
  const { data: library, error: libraryError } = await admin
    .from('libraries')
    .insert({
      project_id: projectId,
      folder_id: null,
      name: libraryName,
      description: 'Conversation player Playwright fixture',
      source_document_id: document.id,
      document_export_type: 'script',
    })
    .select('id')
    .single();
  if (libraryError || !library) {
    throw libraryError ?? new Error('Failed to create conversation library');
  }

  const sectionId = `${library.id}:Script`;
  const { data: fields, error: fieldsError } = await admin
    .from('library_field_definitions')
    .insert(FIELD_LABELS.map((label, orderIndex) => ({
      library_id: library.id,
      section_id: sectionId,
      section: 'Script',
      label,
      data_type: 'string',
      order_index: orderIndex,
      required: false,
    })))
    .select('id, label');
  if (fieldsError || !fields) {
    throw fieldsError ?? new Error('Failed to create conversation fields');
  }

  const rows = [
    {
      name: 'Opening choice',
      values: {
        Label: 'Start',
        Type: '4',
        Name: 'Narrator',
        Content: 'Rain surrounds the old manor.',
        Option0: 'Enter the manor',
        Option0_Next: 'Jump Inside',
        Option0_Commands: '$courage+=2',
        Option1: 'Leave the manor',
        Option1_Next: 'Jump Outside',
        Option1_Commands: '$courage-=1',
      },
    },
    {
      name: 'Inside branch',
      values: {
        Label: 'Inside',
        Type: '1',
        Name: 'Mara',
        Content: 'Inside courage: [courage]',
        Commands: 'End',
      },
    },
    {
      name: 'Outside branch',
      values: {
        Label: 'Outside',
        Type: '2',
        Name: 'Iris',
        Content: 'Outside courage: [courage]',
        Commands: 'End',
      },
    },
  ];

  const { data: assets, error: assetsError } = await admin
    .from('library_assets')
    .insert(rows.map((row, rowIndex) => ({
      library_id: library.id,
      name: row.name,
      row_index: rowIndex,
    })))
    .select('id, row_index');
  if (assetsError || !assets) {
    throw assetsError ?? new Error('Failed to create conversation rows');
  }

  const fieldIdByLabel = new Map(fields.map((field) => [field.label as string, field.id as string]));
  const assetIdByIndex = new Map(assets.map((asset) => [asset.row_index as number, asset.id as string]));
  const values = rows.flatMap((row, rowIndex) =>
    Object.entries(row.values).map(([label, value]) => ({
      asset_id: assetIdByIndex.get(rowIndex)!,
      field_id: fieldIdByLabel.get(label)!,
      value_json: value,
    }))
  );
  const { error: valuesError } = await admin.from('library_asset_values').insert(values);
  if (valuesError) throw valuesError;

  return {
    documentId: document.id as string,
    libraryId: library.id as string,
    libraryName,
  };
}

test.describe.serial('Conversation player PR regression', () => {
  test.setTimeout(180_000);

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId: string;
  let fixture: ConversationFixture;

  async function loginAndOpen(page: Page): Promise<void> {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(owner);
    await login.expectLoginSuccess();
    // Studio routes redirect script libraries into Script; open Script directly.
    await page.goto(
      `/script-system/${projectId}/script/${fixture.libraryId}`,
      { waitUntil: 'domcontentloaded' }
    );
    // Branch title and dialogue line can share this copy after plot-node labeling;
    // wait on the branch chip so strict mode does not match multiple nodes.
    await expect(page.getByTestId('script-branch-name')).toHaveText(
      'Rain surrounds the old manor.',
      { timeout: 45_000 },
    );
  }

  /** Choice buttons only — flow-chart nodes also use role=button with option titles. */
  function choiceButton(page: Page, name: string) {
    return page.locator('button', { hasText: new RegExp(`^${name}$`) });
  }

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'conversation-player-owner');
    projectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });
    fixture = await createConversationFixture(admin, projectId, owner.id);
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('opens Script plot-node dialogue and follows both branches', async ({
    page,
  }) => {
    await loginAndOpen(page);

    await expect(choiceButton(page, 'Enter the manor')).toBeVisible();
    await expect(choiceButton(page, 'Leave the manor')).toBeVisible();
    // Script plot-node mode has no player Restart toolbar.
    await expect(page.getByRole('button', { name: 'Restart', exact: true })).toHaveCount(0);

    await choiceButton(page, 'Enter the manor').click();
    // Plot-node mode does not run option commands; missing vars interpolate to 0.
    await expect(page.getByText('Inside courage: 0', { exact: true })).toBeVisible();
    await expect(page.getByText('Outside courage: 0', { exact: true })).toHaveCount(0);

    await page.locator('[data-flow-node-id="Start"]').click();
    await expect(choiceButton(page, 'Leave the manor')).toBeVisible();

    await choiceButton(page, 'Leave the manor').click();
    await expect(page.getByText('Outside courage: 0', { exact: true })).toBeVisible();

    await page.locator('[data-flow-node-id="Start"]').click();
    await expect(choiceButton(page, 'Enter the manor')).toBeVisible();
  });

  test('restores revealed dialogue and variables after a page refresh', async ({ page }) => {
    test.fail(true, 'Conversation playback progress is not persisted yet');

    await loginAndOpen(page);
    await choiceButton(page, 'Enter the manor').click();
    await expect(page.getByText('Inside courage: 0', { exact: true })).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Inside courage: 0', { exact: true })).toBeVisible();
    await expect(choiceButton(page, 'Enter the manor')).toHaveCount(0);
  });
});
