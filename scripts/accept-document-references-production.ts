import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PRODUCTION_APP_URL = 'https://keco-studio-main.vercel.app';
const PRODUCTION_SUPABASE_URL = 'https://lulrcirmwwvvnupmwqcq.supabase.co';
const PASSWORD = 'Keco-Document-Reference-Acceptance-2026!';
const EVIDENCE_PATH = 'artifacts/document-references-production.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;
type CodecProbeInput =
  | { mode: 'normalize'; markdown: string }
  | { mode: 'state'; snapshot: string | null; updates: string[] };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Required production acceptance environment is missing');
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertUuid(value: unknown, label: string): string {
  assert(typeof value === 'string' && UUID.test(value), `${label} is not a stable UUID`);
  return value;
}

function safeError(error: unknown, stage: string): JsonRecord {
  const rawMessage = error instanceof Error ? error.message : 'Unknown acceptance error';
  return {
    stage,
    code: error instanceof Error && error.name ? error.name : 'UNKNOWN_ERROR',
    message: rawMessage
      .replace(/https?:\/\/[^\s)]+/gi, '<redacted-url>')
      .replace(/(?:file:\/\/|[A-Za-z]:[\\/]|\/home\/|\/tmp\/)[^\s)]+/gi, '<redacted-path>'),
  };
}

function runDocumentCodecProbe<T>(input: CodecProbeInput): T {
  const probe = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      path.join(process.cwd(), 'tests/helpers/documentCodecProbe.ts'),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, DOCUMENT_CODEC_COMMONJS: '1' },
      input: JSON.stringify(input),
    },
  );
  if (probe.status !== 0) {
    throw new Error(probe.stderr || 'Document codec probe failed');
  }
  return JSON.parse(probe.stdout) as T;
}

function createEmptyYjsState(): string {
  const normalized = runDocumentCodecProbe<{ yjsStateBase64?: unknown }>({
    mode: 'normalize',
    markdown: '',
  });
  assert(
    typeof normalized.yjsStateBase64 === 'string',
    'Document codec probe did not return an empty Yjs state',
  );
  return normalized.yjsStateBase64;
}

async function readDurableDocumentMarkdown(
  admin: SupabaseClient,
  documentId: string,
): Promise<string> {
  const document = await admin
    .from('documents')
    .select('yjs_state, collab_epoch')
    .eq('id', documentId)
    .single();
  assert(!document.error && document.data, 'Durable document state was not found');

  const updates = await admin
    .from('document_yjs_updates')
    .select('update_data')
    .eq('document_id', documentId)
    .eq('epoch', document.data.collab_epoch)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  assert(!updates.error, 'Durable document updates could not be read');

  const state = runDocumentCodecProbe<{ markdown?: unknown }>({
    mode: 'state',
    snapshot: document.data.yjs_state,
    updates: (updates.data ?? []).map((update) => update.update_data),
  });
  assert(typeof state.markdown === 'string', 'Document codec probe did not return Markdown');
  return state.markdown;
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto(PRODUCTION_APP_URL);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByTestId('user-menu').waitFor({ state: 'visible', timeout: 60_000 });
}

async function waitForDocument(page: Page): Promise<void> {
  await page.getByTestId('document-collaboration-status').waitFor({
    state: 'visible',
    timeout: 60_000,
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="document-collaboration-status"]')
      ?.getAttribute('data-label') === 'Live'
  );
  await page.locator('[contenteditable="true"]').first().waitFor({
    state: 'visible',
    timeout: 60_000,
  });
}

async function selectDocumentRange(
  preview: Locator,
  startText: string,
  startSelection: string,
  endText: string,
  endSelection: string,
): Promise<{ startBlockId: string; endBlockId: string }> {
  return preview.evaluate((element, values) => {
    const blocks = [...element.querySelectorAll<HTMLElement>('[data-reference-block-id]')];
    const startBlock = blocks.find((block) => block.textContent === values.startText);
    const endBlock = blocks.find((block) => block.textContent === values.endText);
    if (!startBlock || !endBlock) throw new Error('Document preview blocks were not found');

    const findText = (root: HTMLElement, needle: string) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const offset = node.data.indexOf(needle);
        if (offset >= 0) return { node, offset };
      }
      return null;
    };
    const start = findText(startBlock, values.startSelection);
    const end = findText(endBlock, values.endSelection);
    if (!start || !end) throw new Error('Document preview selection text was not found');

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + values.endSelection.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return {
      startBlockId: startBlock.dataset.referenceBlockId ?? '',
      endBlockId: endBlock.dataset.referenceBlockId ?? '',
    };
  }, { startText, startSelection, endText, endSelection });
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  assert(supabaseUrl === PRODUCTION_SUPABASE_URL, 'Acceptance refused a non-production Supabase URL');

  const runTag = randomUUID();
  const email = `document-reference-accept-${runTag}@example.com`;
  const projectId = randomUUID();
  const tableName = `Reference table ${runTag}`;
  const conversationName = `Conversation script ${runTag}`;
  const rowName = 'Arena Alpha';
  const rowValue = 'Central lane control';
  const sourceDocumentName = `Reference source ${runTag}`;
  const targetDocumentName = `Reference target ${runTag}`;
  const sourceHeading = 'Arena routes';
  const sourceFirst = 'Central combat starts here.';
  const sourceSecond = 'Upper route continues here.';
  const selectedText = 'combat starts here. Upper route continues';
  const errors: JsonRecord[] = [];
  const evidence: JsonRecord = {
    checkedAt: new Date().toISOString(),
    projectId,
    tableId: null,
    conversationTableId: null,
    fieldId: null,
    rowId: null,
    sourceDocumentId: null,
    targetDocumentId: null,
    table: {},
    document: {},
    errors,
    passed: false,
    cleanup: { projectDeleted: false, userDeleted: false },
  };
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let stage = 'startup';
  let userId: string | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let acceptancePassed = false;

  await mkdir('artifacts', { recursive: true });
  try {
    stage = 'create-user';
    const createdUser = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    assert(!createdUser.error && createdUser.data.user, 'Production acceptance user creation failed');
    userId = assertUuid(createdUser.data.user.id, 'User ID');

    stage = 'create-project';
    const project = await admin.from('projects').insert({
      id: projectId,
      owner_id: userId,
      name: `Document reference acceptance ${runTag}`,
      description: 'Disposable production document-reference fixture',
    });
    assert(!project.error, 'Production document-reference project creation failed');

    stage = 'create-documents';
    const emptyYjsState = createEmptyYjsState();
    const documents = await admin.from('documents').insert([
      {
        project_id: projectId,
        name: sourceDocumentName,
        content: `# ${sourceHeading}\n\n${sourceFirst}\n\n${sourceSecond}\n`,
        yjs_state: emptyYjsState,
        created_by: userId,
      },
      {
        project_id: projectId,
        name: targetDocumentName,
        content: '',
        created_by: userId,
      },
    ]).select('id, name, content, yjs_state');
    assert(!documents.error && documents.data?.length === 2, 'Production document fixtures failed');
    const sourceDocument = documents.data.find((document) => document.name === sourceDocumentName);
    const targetDocument = documents.data.find((document) => document.name === targetDocumentName);
    const sourceDocumentId = assertUuid(sourceDocument?.id, 'Source document ID');
    const targetDocumentId = assertUuid(targetDocument?.id, 'Target document ID');
    evidence.sourceDocumentId = sourceDocumentId;
    evidence.targetDocumentId = targetDocumentId;
    assert(sourceDocument?.content?.includes(sourceSecond), 'Fallback document content was not stored');
    assert(sourceDocument?.yjs_state === emptyYjsState, 'Empty collaboration state changed');

    stage = 'create-tables';
    const libraries = await admin.from('libraries').insert([
      { project_id: projectId, name: tableName },
      {
        project_id: projectId,
        name: conversationName,
        source_document_id: sourceDocumentId,
        document_export_type: 'script',
      },
    ]).select('id, name');
    assert(!libraries.error && libraries.data?.length === 2, 'Production table fixtures failed');
    const tableId = assertUuid(
      libraries.data.find((library) => library.name === tableName)?.id,
      'Table ID',
    );
    const conversationTableId = assertUuid(
      libraries.data.find((library) => library.name === conversationName)?.id,
      'Conversation table ID',
    );
    evidence.tableId = tableId;
    evidence.conversationTableId = conversationTableId;

    const field = await admin.from('library_field_definitions').insert({
      library_id: tableId,
      section_id: `${tableId}:General`,
      section: 'General',
      label: 'Current label',
      data_type: 'string',
      order_index: 0,
      required: false,
    }).select('id').single();
    assert(!field.error && field.data, 'Production table field fixture failed');
    const fieldId = assertUuid(field.data.id, 'Field ID');
    evidence.fieldId = fieldId;
    const row = await admin.from('library_assets').insert({
      library_id: tableId,
      name: rowName,
      row_index: 0,
    }).select('id').single();
    assert(!row.error && row.data, 'Production table row fixture failed');
    const rowId = assertUuid(row.data.id, 'Row ID');
    evidence.rowId = rowId;
    const value = await admin.from('library_asset_values').insert({
      asset_id: rowId,
      field_id: fieldId,
      value_json: rowValue,
    });
    assert(!value.error, 'Production table value fixture failed');

    stage = 'browser-login';
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 500) pageErrors.push(`HTTP ${response.status()} response`);
    });
    await login(page, email);

    stage = 'open-target-document';
    await page.goto(`${PRODUCTION_APP_URL}/${projectId}/doc/${targetDocumentId}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForDocument(page);
    const editor = page.locator('[contenteditable="true"]').first();

    stage = 'insert-table-reference';
    await page.getByRole('button', { name: 'Insert reference' }).click();
    let dialog = page.getByRole('dialog', { name: 'Insert reference' });
    await dialog.waitFor({ state: 'visible' });
    const tableSelect = dialog.getByRole('combobox', { name: 'Table', exact: true });
    await tableSelect.click();
    await tableSelect.fill(tableName);
    await page.getByRole('option', { name: tableName, exact: true }).waitFor({ state: 'visible' });
    await tableSelect.fill(conversationName);
    assert(
      await page.getByRole('option', { name: conversationName, exact: true }).count() === 0,
      'Conversation table remained visible in the reference picker',
    );
    await tableSelect.fill(tableName);
    await tableSelect.press('Enter');
    const rowOption = dialog.getByRole('option', { name: `Row: ${rowValue}` });
    await rowOption.waitFor({ state: 'visible' });
    assert((await rowOption.textContent())?.includes(rowValue), 'Table row value was inaccurate');
    await rowOption.click();
    await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const tableReference = page.locator(`a[href*="/${projectId}/${tableId}?asset=${rowId}"]`);
    await tableReference.waitFor({ state: 'visible' });
    assert((await tableReference.textContent()) === rowValue, 'Inserted table reference text changed');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForDocument(page);
    await tableReference.waitFor({ state: 'visible' });
    assert((await tableReference.textContent()) === rowValue, 'Table reference did not survive reload');
    const tableMarkdown = await readDurableDocumentMarkdown(admin, targetDocumentId);
    assert(
      tableMarkdown.includes('kind="table-row"')
        && tableMarkdown.includes(`libraryId="${tableId}"`)
        && tableMarkdown.includes(`assetId="${rowId}"`)
        && tableMarkdown.includes(`displayFieldId="${fieldId}"`),
      'Authoritative document state omitted the table reference',
    );
    evidence.table = {
      conversationFiltered: true,
      sourceSelected: true,
      rowName,
      rowValue,
      insertedText: rowValue,
      reloaded: true,
      authoritativeReadBack: true,
    };

    stage = 'insert-document-reference';
    await editor.click();
    await editor.press('End');
    await page.getByRole('button', { name: 'Insert reference' }).click();
    dialog = page.getByRole('dialog', { name: 'Insert reference' });
    await dialog.getByRole('tab', { name: 'Document' }).click();
    const documentSelect = dialog.getByRole('combobox', { name: 'Document', exact: true });
    await documentSelect.click();
    await documentSelect.fill(sourceDocumentName);
    await page.getByRole('option', { name: sourceDocumentName, exact: true })
      .waitFor({ state: 'visible' });
    await documentSelect.press('Enter');
    const preview = dialog.getByLabel('Document text preview');
    await preview.waitFor({ state: 'visible' });
    assert((await preview.textContent())?.includes(sourceFirst), 'Legacy document preview omitted content');
    assert((await preview.textContent())?.includes(sourceSecond), 'Legacy document preview was incomplete');
    const selectedRange = await selectDocumentRange(
      preview,
      sourceFirst,
      'combat starts here.',
      sourceSecond,
      'Upper route continues',
    );
    const startBlockId = assertUuid(selectedRange.startBlockId, 'Document range start block ID');
    const endBlockId = assertUuid(selectedRange.endBlockId, 'Document range end block ID');
    await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const documentReference = page.locator(
      `a[href^="/${projectId}/doc/${sourceDocumentId}#block-"]`,
    );
    await documentReference.waitFor({ state: 'visible' });
    assert(
      (await documentReference.textContent()) === selectedText,
      'Inserted document reference text changed',
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForDocument(page);
    await documentReference.waitFor({ state: 'visible' });
    assert(
      (await documentReference.textContent()) === selectedText,
      'Document reference did not survive reload',
    );
    const finalMarkdown = await readDurableDocumentMarkdown(admin, targetDocumentId);
    assert(
      finalMarkdown.includes('kind="document-range"')
        && finalMarkdown.includes(`documentId="${sourceDocumentId}"`)
        && finalMarkdown.includes(`startBlockId="${startBlockId}"`)
        && finalMarkdown.includes(`endBlockId="${endBlockId}"`),
      'Authoritative document state omitted the document range reference',
    );
    evidence.document = {
      contentFallbackReadBack: true,
      startBlockId,
      endBlockId,
      previewFirst: sourceFirst,
      previewSecond: sourceSecond,
      selectedText,
      insertedText: selectedText,
      reloaded: true,
      authoritativeReadBack: true,
    };
    assert(pageErrors.length === 0, `Browser reported errors: ${pageErrors.join('; ')}`);
    await context.close();
    acceptancePassed = true;
  } catch (error) {
    errors.push(safeError(error, stage));
  } finally {
    await browser?.close().catch(() => undefined);
    stage = 'cleanup-project';
    const projectCleanup = await admin.from('projects').delete().eq('id', projectId);
    if (projectCleanup.error) errors.push(safeError(projectCleanup.error, stage));
    else (evidence.cleanup as JsonRecord).projectDeleted = true;

    if (userId) {
      stage = 'cleanup-user';
      const userCleanup = await admin.auth.admin.deleteUser(userId);
      if (userCleanup.error) errors.push(safeError(userCleanup.error, stage));
      else (evidence.cleanup as JsonRecord).userDeleted = true;
    }
    evidence.passed = acceptancePassed && errors.length === 0
      && (evidence.cleanup as JsonRecord).projectDeleted === true
      && (evidence.cleanup as JsonRecord).userDeleted === true;
    await writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
  }

  if (evidence.passed !== true) {
    throw new Error('Production document-reference acceptance failed');
  }
}

void main().catch(() => {
  console.error('Production document-reference acceptance failed');
  process.exitCode = 1;
});
