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
  libraryId: string;
  libraryName: string;
};

const FIELD_LABELS = [
  'Story jump node',
  'Type',
  'Speaker',
  'Dialogue and options',
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

  const sectionId = `${library.id}:Conversation`;
  const { data: fields, error: fieldsError } = await admin
    .from('library_field_definitions')
    .insert(FIELD_LABELS.map((label, orderIndex) => ({
      library_id: library.id,
      section_id: sectionId,
      section: 'Conversation',
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
        'Story jump node': 'Start',
        Type: '4',
        Speaker: 'Narrator',
        'Dialogue and options': 'Rain surrounds the old manor.',
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
        'Story jump node': 'Inside',
        Type: '1',
        Speaker: 'Mara',
        'Dialogue and options': 'Inside courage: [courage]',
        Commands: 'End',
      },
    },
    {
      name: 'Outside branch',
      values: {
        'Story jump node': 'Outside',
        Type: '2',
        Speaker: 'Iris',
        'Dialogue and options': 'Outside courage: [courage]',
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

  return { libraryId: library.id as string, libraryName };
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
    await page.goto(`/${projectId}/${fixture.libraryId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeVisible({
      timeout: 30_000,
    });
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

  test('opens a conversation, follows both branches, and resets variables on Restart', async ({
    page,
  }) => {
    await loginAndOpen(page);

    await expect(page.getByText('Rain surrounds the old manor.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter the manor', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leave the manor', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Enter the manor', exact: true }).click();
    await expect(page.getByText('Inside courage: 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Outside courage: -1', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await expect(page.getByText('Inside courage: 2', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Leave the manor', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Leave the manor', exact: true }).click();
    await expect(page.getByText('Outside courage: -1', { exact: true })).toBeVisible();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByRole('button', { name: 'Restart', exact: true }).click();
      await expect(page.getByText('Outside courage: -1', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Enter the manor', exact: true })).toBeVisible();
    }
  });

  test('restores revealed dialogue and variables after a page refresh', async ({ page }) => {
    test.fail(true, 'Conversation playback progress is not persisted yet');

    await loginAndOpen(page);
    await page.getByRole('button', { name: 'Enter the manor', exact: true }).click();
    await expect(page.getByText('Inside courage: 2', { exact: true })).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Inside courage: 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter the manor', exact: true })).toHaveCount(0);
  });
});
