import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import { LoginPage, type UserCredentials } from '../pages/login.page';
import { users } from '../fixures/users';
import { expectDocumentLive } from '../utils/document-assertions';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type AuthenticatedClient = {
  client: SupabaseClient;
  accessToken: string;
  userId: string;
};

type Phase2Fixture = {
  owner: AuthenticatedClient;
  viewer: AuthenticatedClient;
  outsider: AuthenticatedClient;
  service: SupabaseClient;
  projectId: string;
  foreignProjectId: string;
  foreignFolderId: string;
};

function makeClient(key: string): SupabaseClient {
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  return createClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function authenticate(
  credentials: UserCredentials
): Promise<AuthenticatedClient> {
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required');
  const client = makeClient(anonKey);
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error || !data.user || !data.session?.access_token) {
    throw error ?? new Error(`Could not authenticate ${credentials.email}`);
  }
  return {
    client,
    accessToken: data.session.access_token,
    userId: data.user.id,
  };
}

function rpcProjectId(data: unknown): string {
  const projectId = String(
    (data as { project_id?: unknown } | null)?.project_id ?? ''
  );
  if (!projectId) throw new Error('Project fixture did not return project_id');
  return projectId;
}

function rpcFolderId(data: unknown): string {
  const folderId = String(
    (data as { folder_id?: unknown } | null)?.folder_id ?? ''
  );
  if (!folderId) throw new Error('Project fixture did not return folder_id');
  return folderId;
}

async function createFixture(): Promise<Phase2Fixture> {
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const [owner, viewer, outsider] = await Promise.all([
    authenticate(users.seedEmpty2),
    authenticate(users.seedEmpty4),
    authenticate(users.seedEmpty),
  ]);
  const service = makeClient(serviceRoleKey);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [project, foreignProject] = await Promise.all([
    owner.client.rpc('create_project_with_default_resource', {
      p_name: `Phase 2 browser ${suffix}`,
      p_description: 'Phase 2C-2F browser acceptance fixture',
    }),
    owner.client.rpc('create_project_with_default_resource', {
      p_name: `Phase 2 foreign ${suffix}`,
      p_description: 'Cross-project document import isolation fixture',
    }),
  ]);
  if (project.error) throw project.error;
  if (foreignProject.error) throw foreignProject.error;
  const projectId = rpcProjectId(project.data);
  const foreignProjectId = rpcProjectId(foreignProject.data);

  const membership = await service.from('project_collaborators').upsert(
    {
      project_id: projectId,
      user_id: viewer.userId,
      role: 'viewer',
      invited_by: owner.userId,
      accepted_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,project_id' }
  );
  if (membership.error) throw membership.error;

  return {
    owner,
    viewer,
    outsider,
    service,
    projectId,
    foreignProjectId,
    foreignFolderId: rpcFolderId(foreignProject.data),
  };
}

async function loginAndOpen(
  browser: Browser,
  credentials: UserCredentials,
  path: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const login = new LoginPage(page);
  await login.goto();
  await login.login(credentials);
  await login.expectLoginSuccess();
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

async function importDocumentThroughSidebar(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer }
): Promise<string> {
  await page
    .getByTitle('Add new folder, library, or document')
    .click();
  await page.getByRole('menuitem', { name: 'Import new document' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Import document', { exact: true })).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles(file);
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  const alert = dialog.getByRole('alert');
  await Promise.race([
    page.waitForURL(/\/doc\/[0-9a-f-]+$/i, { timeout: 60_000 }),
    alert.waitFor({ state: 'visible', timeout: 60_000 }).then(async () => {
      throw new Error((await alert.textContent()) ?? 'Document import failed');
    }),
  ]);
  return page.url().split('/').at(-1) ?? '';
}

async function downloadFromEditor(
  page: Page,
  command: 'Download DOCX' | 'Download PDF'
): Promise<Buffer> {
  await page.getByTestId('document-export').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByText(command, { exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error(`${command} did not produce a local download`);
  return readFile(path);
}

function extractUncompressedPdfText(bytes: Buffer): string {
  const source = bytes.toString('latin1');
  const textObjects = source.match(/BT[\s\S]*?ET/g) ?? [];
  const literalStrings = textObjects.flatMap((object) =>
    [...object.matchAll(/\((?:\\.|[^\\)])*\)/g)].map((match) =>
      match[0]
        .slice(1, -1)
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\([0-7]{1,3})/g, (_, octal: string) =>
          String.fromCharCode(Number.parseInt(octal, 8))
        )
    )
  );
  const hexStrings = textObjects.flatMap((object) =>
    [...object.matchAll(/<([0-9A-Fa-f]+)>/g)].map((match) =>
      Buffer.from(match[1], 'hex').toString('latin1')
    )
  );
  return [...literalStrings, ...hexStrings].join(' ');
}

function expectPdfUnicodeMappings(bytes: Buffer, expectedText: string): void {
  const source = bytes.toString('latin1');
  const unicodeMaps = (
    source.match(/begin(?:bfchar|bfrange)[\s\S]*?end(?:bfchar|bfrange)/g) ?? []
  ).join('\n');

  expect(source).toContain('/Subtype /Type0');
  expect(source).toContain('/ToUnicode');
  expect(source).toMatch(/\/FontFile[23]?\b/);
  for (const character of new Set([...expectedText])) {
    if (character.codePointAt(0)! <= 0xff) continue;
    const utf16Be = Buffer.from(character, 'utf16le').swap16().toString('hex');
    expect(unicodeMaps).toContain(`<${utf16Be}>`);
  }
}

async function extractPdfTextWithPdfJs(bytes: Buffer): Promise<{
  pageCount: number;
  text: string;
  operatorCount: number;
  glyphWarnings: string[];
}> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const document = await loadingTask.promise;
  try {
    const pages: string[] = [];
    const glyphWarnings: string[] = [];
    let operatorCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        const message = args.map(String).join(' ');
        if (!message.includes('standardFontDataUrl')) glyphWarnings.push(message);
        originalWarn(...args);
      };
      try {
        const operatorList = await page.getOperatorList();
        operatorCount += operatorList.fnArray.length;
        const content = await page.getTextContent();
        pages.push(
          content.items
            .map((item) =>
              'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''
            )
            .join('')
            .trim()
        );
      } finally {
        console.warn = originalWarn;
      }
    }
    return {
      pageCount: document.numPages,
      text: pages.join('\n'),
      operatorCount,
      glyphWarnings,
    };
  } finally {
    await loadingTask.destroy();
  }
}

function expectTextInOrder(actual: string, expected: readonly string[]): void {
  const normalized = normalizeExtractedPdfText(actual);
  let previousIndex = -1;
  for (const segment of expected) {
    const index = normalized.indexOf(normalizeExtractedPdfText(segment));
    expect(index).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

function normalizeExtractedPdfText(value: string): string {
  return value.replace(/[\s\u0000]+/g, '');
}

async function makeStructuredDocx(suffix: string): Promise<Buffer> {
  const png = Buffer.concat([
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    ),
    Buffer.alloc(5 * 1024),
  ]);
  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'phase-2-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: 'start',
            },
          ],
        },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({
            text: `DOCX Phase 2 ${suffix}`,
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Bold marker', bold: true }),
              new TextRun(' and '),
              new TextRun({ text: 'italic marker', italics: true }),
              new TextRun(` localized text ${suffix}`),
            ],
          }),
          new Paragraph({ text: `Bullet ${suffix}`, bullet: { level: 0 } }),
          new Paragraph({
            text: `Ordered ${suffix}`,
            numbering: { reference: 'phase-2-numbering', level: 0 },
          }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('Field')] }),
                  new TableCell({ children: [new Paragraph('Value')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('Status')] }),
                  new TableCell({ children: [new Paragraph(`Complete ${suffix}`)] }),
                ],
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun('Open '),
              new ExternalHyperlink({
                link: `https://example.com/docx?run=${suffix}`,
                children: [new TextRun('DOCX link')],
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun('Image '),
              new ImageRun({
                data: png,
                transformation: { width: 24, height: 24 },
                type: 'png',
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}

async function apiFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`http://localhost:3000${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });
}

test.describe.serial('Phase 2C-2F browser acceptance', () => {
  test.setTimeout(360_000);
  let fixture: Phase2Fixture;
  let importedMarkdownDocumentId = '';

  test.beforeAll(async () => {
    fixture = await createFixture();
  });

  test.afterAll(async () => {
    if (!fixture) return;
    await Promise.all([
      fixture.owner.client.removeAllChannels(),
      fixture.viewer.client.removeAllChannels(),
      fixture.outsider.client.removeAllChannels(),
    ]);
    const cleanup = await fixture.service
      .from('projects')
      .delete()
      .in('id', [fixture.projectId, fixture.foreignProjectId]);
    if (cleanup.error) throw cleanup.error;
  });

  test('imports sanctioned Markdown, immediately exports the live edit, and preserves viewer access', async ({
    browser,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const initialMarker = `ROOT-${suffix}`;
    const editedMarker = `${initialMarker}-EDITED`;
    const chinesePdfText = '\u4e2d\u6587 PDF \u5bfc\u51fa\u9a8c\u8bc1\uff1a\u4f60\u597d\u4e16\u754c';
    const chinesePdfHeading = `\u4e2d\u6587 Phase 2 Markdown ${suffix}`;
    const markdown = [
      `# ${chinesePdfHeading}`,
      '',
      'Localized acceptance content',
      '',
      chinesePdfText,
      '',
      '<Callout type="info" title="Tip &amp; explanation">',
      '',
      `Callout localized text ${suffix}`,
      '',
      '</Callout>',
      '',
      '<Details summary="View more">',
      '',
      `Details localized text ${suffix}`,
      '',
      '</Details>',
      '',
      '| Item | Status |',
      '| --- | --- |',
      '| Import | Complete |',
      '',
      `[Safe link](https://example.com/phase2?run=${suffix})`,
      '',
      initialMarker,
      '',
    ].join('\n');

    const owner = await loginAndOpen(
      browser,
      users.seedEmpty2,
      `/${fixture.projectId}`
    );
    let documentId = '';
    try {
      documentId = await importDocumentThroughSidebar(owner.page, {
        name: `phase-2-${suffix}.md`,
        mimeType: 'text/markdown',
        buffer: Buffer.from(markdown, 'utf8'),
      });
      expect(documentId).toMatch(/^[0-9a-f-]{36}$/i);
      importedMarkdownDocumentId = documentId;
      await expectDocumentLive(owner.page);
      await expect(owner.page.locator('[data-component="Callout"]')).toContainText(
        `Callout localized text ${suffix}`
      );
      await expect(owner.page.locator('[data-component="Details"]')).toContainText(
        `Details localized text ${suffix}`
      );
      await expect(owner.page.locator('[contenteditable="true"]').first()).toContainText(
        chinesePdfText
      );
      await expect(owner.page.locator('table')).toContainText('Import');
      await expect(
        owner.page.getByRole('link', { name: 'Safe link' })
      ).toHaveAttribute('href', `https://example.com/phase2?run=${suffix}`);
      await expect(owner.page.locator('[contenteditable="true"]').first()).toContainText(
        initialMarker
      );

      const markerParagraph = owner.page
        .locator('[contenteditable="true"] p', { hasText: initialMarker })
        .first();
      await markerParagraph.click();
      await markerParagraph.press('End');
      await owner.page.keyboard.insertText('-EDITED');
      const docx = await downloadFromEditor(owner.page, 'Download DOCX');
      const docxHtml = (await mammoth.convertToHtml({ buffer: docx })).value;
      expect(docxHtml).toContain(editedMarker);
      expect(docxHtml).toContain('Tip &amp; explanation');
      expect(docxHtml).not.toContain('&amp;amp;');

      const pdf = await downloadFromEditor(owner.page, 'Download PDF');
      expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(pdf.length).toBeLessThan(1_000_000);
      expectPdfUnicodeMappings(pdf, chinesePdfText);
      const parsedPdf = await extractPdfTextWithPdfJs(pdf);
      expect(parsedPdf.pageCount).toBeGreaterThanOrEqual(1);
      expect(parsedPdf.operatorCount).toBeGreaterThan(0);
      expect(parsedPdf.glyphWarnings).toEqual([]);
      expectTextInOrder(parsedPdf.text, [
        chinesePdfHeading,
        'Localized acceptance content',
        chinesePdfText,
        'Tip & explanation',
        `Callout localized text ${suffix}`,
        'View more',
        `Details localized text ${suffix}`,
        'Item | Status',
        'Import | Complete',
        'Safe link',
        editedMarker,
      ]);
      expect(normalizeExtractedPdfText(extractUncompressedPdfText(pdf))).toContain(
        normalizeExtractedPdfText(editedMarker)
      );
    } finally {
      await owner.context.close();
    }

    const viewer = await loginAndOpen(
      browser,
      users.seedEmpty4,
      `/${fixture.projectId}/doc/${documentId}`
    );
    try {
      await expectDocumentLive(viewer.page, 'View only - Live');
      await expect(viewer.page.locator('[data-component="Callout"]')).toContainText(
        `Callout localized text ${suffix}`
      );
      await expect(viewer.page.locator('[data-component="Details"]')).toContainText(
        `Details localized text ${suffix}`
      );
      await expect(viewer.page.locator('[contenteditable="true"]')).toHaveCount(0);
      await expect(viewer.page.locator('[contenteditable="false"]').first()).toBeVisible();
      await expect(viewer.page.getByText('Import document', { exact: true })).toHaveCount(0);
      await expect(
        viewer.page.getByTitle('Add new folder, library, or document')
      ).toHaveCount(0);
      const viewerDocx = await downloadFromEditor(viewer.page, 'Download DOCX');
      const viewerHtml = (await mammoth.convertToHtml({ buffer: viewerDocx })).value;
      expect(viewerHtml).toContain(editedMarker);
    } finally {
      await viewer.context.close();
    }
  });

  test('imports a real structured DOCX as a collaborative document', async ({
    browser,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const owner = await loginAndOpen(
      browser,
      users.seedEmpty2,
      `/${fixture.projectId}`
    );
    try {
      const documentId = await importDocumentThroughSidebar(owner.page, {
        name: `structured-${suffix}.docx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: await makeStructuredDocx(suffix),
      });
      expect(documentId).toMatch(/^[0-9a-f-]{36}$/i);
      await expectDocumentLive(owner.page);
      await expect(owner.page.getByRole('heading', {
        name: `DOCX Phase 2 ${suffix}`,
      })).toBeVisible();
      await expect(owner.page.getByText(`Bullet ${suffix}`, { exact: true })).toBeVisible();
      await expect(owner.page.getByText(`Ordered ${suffix}`, { exact: true })).toBeVisible();
      await expect(owner.page.locator('table')).toContainText(`Complete ${suffix}`);
      await expect(owner.page.getByRole('link', { name: 'DOCX link' })).toHaveAttribute(
        'href',
        `https://example.com/docx?run=${suffix}`
      );
      await expect(owner.page.getByText(`localized text ${suffix}`, { exact: false })).toBeVisible();
      await expect(owner.page.locator('img[alt="Imported image 1"]')).toBeVisible();

      await owner.page.reload({ waitUntil: 'domcontentloaded' });
      await expectDocumentLive(owner.page);
      await expect(owner.page.getByRole('heading', {
        name: `DOCX Phase 2 ${suffix}`,
      })).toBeVisible();
      await expect(owner.page.locator('table')).toContainText(`Complete ${suffix}`);
      await expect(owner.page.locator('img[alt="Imported image 1"]')).toBeVisible();
    } finally {
      await owner.context.close();
    }
  });

  test('enforces import and export API role isolation', async () => {
    expect(importedMarkdownDocumentId).toMatch(/^[0-9a-f-]{36}$/i);
    const before = await fixture.service
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', fixture.projectId);
    if (before.error) throw before.error;

    const viewerImport = await apiFetch(
      fixture.viewer.accessToken,
      '/api/documents/import',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: crypto.randomUUID(),
          versionId: crypto.randomUUID(),
          projectId: fixture.projectId,
          folderId: null,
          name: 'Viewer forbidden import',
          markdown: '# Viewer import must fail',
        }),
      }
    );
    expect(viewerImport.status).toBe(403);

    const wrongProjectFolder = await apiFetch(
      fixture.owner.accessToken,
      '/api/documents/import',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: crypto.randomUUID(),
          versionId: crypto.randomUUID(),
          projectId: fixture.projectId,
          folderId: fixture.foreignFolderId,
          name: 'Cross-project folder import',
          markdown: '# Cross-project folder must fail',
        }),
      }
    );
    expect(wrongProjectFolder.status).toBe(403);

    const after = await fixture.service
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', fixture.projectId);
    if (after.error) throw after.error;
    expect(after.count).toBe(before.count);

    const outsiderExport = await apiFetch(
      fixture.outsider.accessToken,
      `/api/documents/${importedMarkdownDocumentId}/export?format=docx`
    );
    expect(outsiderExport.status).toBe(404);

    const viewerExport = await apiFetch(
      fixture.viewer.accessToken,
      `/api/documents/${importedMarkdownDocumentId}/export?format=docx`
    );
    expect(viewerExport.status).toBe(200);
    expect(viewerExport.headers.get('content-type')).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(viewerExport.headers.get('content-disposition')).toContain('attachment');
    expect(viewerExport.headers.get('cache-control')).toContain('no-store');
    const viewerHtml = (
      await mammoth.convertToHtml({
        buffer: Buffer.from(await viewerExport.arrayBuffer()),
      })
    ).value;
    expect(viewerHtml).toContain('ROOT-');
    expect(viewerHtml).toContain('-EDITED');
  });
});
