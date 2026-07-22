import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { ToolContext, ToolResult, UserRole } from '@/lib/agent/types';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/documentEmbeddingIndexService', () => ({
  reindexProjectDocumentAsActor: jest.fn().mockResolvedValue({
    documentId: 'mock-document-id',
    chunks: 0,
  }),
}));
jest.mock('@/lib/documents/documentContentCodec', () => {
  const decode = (value: string | null): string =>
    value ? Buffer.from(value, 'base64').toString('utf8') : '';
  const encode = (value: string): string =>
    Buffer.from(value, 'utf8').toString('base64');
  const mergeYjsState = (
    snapshot: string | null,
    updates: readonly string[]
  ): string => updates.at(-1) ?? snapshot ?? encode('');
  return {
    mergeYjsState,
    documentContentCodec: {
      validate: (markdown: string) => ({ markdown }),
      markdownToYjsState: async (markdown: string) => encode(markdown),
      yjsStateToMarkdown: async (
        snapshot: string | null,
        updates: readonly string[]
      ) => decode(mergeYjsState(snapshot, updates)),
      mergeYjsState,
    },
  };
});

import { createDocumentTool } from '@/lib/agent/tools/create-document';
import { readDocument } from '@/lib/agent/tools/read-document';
import { proposeDocumentEdit } from '@/lib/agent/tools/propose-document-edit';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
  type RlsUser,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

function context(
  actor: RlsUser,
  projectId: string,
  userRole: UserRole
): ToolContext {
  return {
    userId: actor.id,
    projectId,
    conversationId: randomUUID(),
    userRole,
    supabase: actor.client,
  };
}

function documentId(result: ToolResult): string {
  const id = (result.data as { documentId?: unknown } | undefined)?.documentId;
  if (typeof id !== 'string') {
    throw new Error(`Agent tool did not return a document id: ${result.error}`);
  }
  return id;
}

describeDb('Agent document tools caller RLS (live database)', () => {
  let fx: ProjectFixture;
  let other: ProjectFixture;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    other = await buildProjectFixture();
  }, 120_000);

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
    if (other) await teardownProjectFixture(other);
  }, 60_000);

  async function createThroughAgent(
    actor: RlsUser,
    role: UserRole,
    label: string
  ): Promise<string> {
    const created = await createDocumentTool.execute(
      {
        name: `agent-${label}-${fx.suffix}`,
        content: `# ${label} seed\n\nInitial document content`,
      },
      context(actor, fx.projectId, role)
    );
    if (!created.success) {
      throw new Error(`create_document failed for ${label}: ${created.error}`);
    }
    return documentId(created);
  }

  it('allows owners and editors to create, read, and confirm restorable edits', async () => {
    for (const [label, actor, role] of [
      ['owner', fx.owner, 'admin'],
      ['editor', fx.editor, 'editor'],
    ] as const) {
      const ctx = context(actor, fx.projectId, role);
      const id = await createThroughAgent(actor, role, label);

      await expect(readDocument.execute({ documentId: id }, ctx)).resolves.toMatchObject({
        success: true,
        data: {
          documentId: id,
          projectId: fx.projectId,
          markdown: expect.stringContaining(`${label} seed`),
        },
      });

      const proposedMarkdown = `# ${label} confirmed edit\n\nConfirmed document content`;
      const params = {
        documentId: id,
        operation: { type: 'replace_all' as const, markdown: proposedMarkdown },
      };
      const preview = await proposeDocumentEdit.execute(params, ctx);
      expect(preview).toMatchObject({ success: true });
      const applied = await proposeDocumentEdit.executeImport!(preview, params, ctx);
      expect(applied).toMatchObject({
        success: true,
        data: { documentId: id, token: { epoch: 1 } },
      });

      const { data: stored, error: storedError } = await fx.svc
        .from('documents')
        .select('content, collab_epoch, collab_revision')
        .eq('id', id)
        .single();
      expect(storedError).toBeNull();
      expect(stored).toMatchObject({
        content: proposedMarkdown,
        collab_epoch: 1,
        collab_revision: 2,
      });

      const { data: versions, error: versionsError } = await fx.svc
        .from('document_versions')
        .select('version_type, snapshot_content, created_by')
        .eq('document_id', id);
      expect(versionsError).toBeNull();
      expect(versions).toEqual([
        expect.objectContaining({
          version_type: 'pre_agent',
          snapshot_content: expect.stringContaining(`${label} seed`),
          created_by: actor.id,
        }),
      ]);
    }
  });

  it('allows viewer reads but denies viewer create and confirmed edit', async () => {
    const id = await createThroughAgent(fx.owner, 'admin', 'viewer-readable');
    const viewerCtx = context(fx.viewer, fx.projectId, 'viewer');

    await expect(
      readDocument.execute({ documentId: id }, viewerCtx)
    ).resolves.toMatchObject({
      success: true,
      data: { documentId: id, markdown: expect.stringContaining('viewer-readable') },
    });

    const deniedName = `agent-viewer-denied-${fx.suffix}`;
    await expect(
      createDocumentTool.execute(
        { name: deniedName, content: '# Viewer must not create' },
        viewerCtx
      )
    ).resolves.toMatchObject({ success: false });

    const params = {
      documentId: id,
      operation: { type: 'replace_all' as const, markdown: '# Viewer must not edit' },
    };
    const preview = await proposeDocumentEdit.execute(params, viewerCtx);
    expect(preview).toMatchObject({ success: true });
    await expect(
      proposeDocumentEdit.executeImport!(preview, params, viewerCtx)
    ).resolves.toMatchObject({ success: false });

    const [{ count: createdCount }, { data: stored }, { count: versionCount }] =
      await Promise.all([
        fx.svc
          .from('documents')
          .select('id', { count: 'exact', head: true })
          .eq('name', deniedName),
        fx.svc.from('documents').select('content').eq('id', id).single(),
        fx.svc
          .from('document_versions')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', id),
      ]);
    expect(createdCount).toBe(0);
    expect(stored?.content).toContain('viewer-readable');
    expect(versionCount).toBe(0);
  });

  it('hides documents from outsiders and cross-project actors and rejects their edits', async () => {
    const id = await createThroughAgent(fx.editor, 'editor', 'isolated');
    const ownerCtx = context(fx.owner, fx.projectId, 'admin');
    const approvedParams = {
      documentId: id,
      operation: { type: 'replace_all' as const, markdown: '# Hidden edit payload' },
    };
    const approvedPreview = await proposeDocumentEdit.execute(approvedParams, ownerCtx);
    expect(approvedPreview).toMatchObject({ success: true });

    for (const deniedCtx of [
      context(fx.outsider, fx.projectId, 'viewer'),
      context(other.editor, other.projectId, 'editor'),
    ]) {
      await expect(
        readDocument.execute({ documentId: id }, deniedCtx)
      ).resolves.toMatchObject({ success: false });
      await expect(
        proposeDocumentEdit.execute(
          { documentId: id, operation: { type: 'replace_all', markdown: '# Unauthorized proposal' } },
          deniedCtx
        )
      ).resolves.toMatchObject({ success: false });
      await expect(
        proposeDocumentEdit.executeImport!(approvedPreview, approvedParams, deniedCtx)
      ).resolves.toMatchObject({ success: false });
    }

    const { data: stored, error } = await fx.svc
      .from('documents')
      .select('content')
      .eq('id', id)
      .single();
    expect(error).toBeNull();
    expect(stored?.content).toContain('isolated seed');
  });

  it('rejects a stale confirmed edit without overwriting newer Agent work', async () => {
    const id = await createThroughAgent(fx.owner, 'admin', 'stale');
    const editorCtx = context(fx.editor, fx.projectId, 'editor');
    const ownerCtx = context(fx.owner, fx.projectId, 'admin');

    const staleParams = {
      documentId: id,
      operation: { type: 'replace_all' as const, markdown: '# Stale editor replacement' },
    };
    const newerParams = {
      documentId: id,
      operation: { type: 'replace_all' as const, markdown: '# Newer owner replacement' },
    };
    const stalePreview = await proposeDocumentEdit.execute(staleParams, editorCtx);
    const newerPreview = await proposeDocumentEdit.execute(newerParams, ownerCtx);
    expect(stalePreview).toMatchObject({ success: true });
    expect(newerPreview).toMatchObject({ success: true });

    await expect(
      proposeDocumentEdit.executeImport!(newerPreview, newerParams, ownerCtx)
    ).resolves.toMatchObject({ success: true });
    await expect(
      proposeDocumentEdit.executeImport!(stalePreview, staleParams, editorCtx)
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('changed after this edit was proposed'),
    });

    const [{ data: stored }, { data: versions }] = await Promise.all([
      fx.svc
        .from('documents')
        .select('content, collab_epoch, collab_revision')
        .eq('id', id)
        .single(),
      fx.svc
        .from('document_versions')
        .select('version_type, snapshot_content')
        .eq('document_id', id),
    ]);
    expect(stored).toMatchObject({
      content: '# Newer owner replacement',
      collab_epoch: 1,
      collab_revision: 2,
    });
    expect(versions).toEqual([
      expect.objectContaining({
        version_type: 'pre_agent',
        snapshot_content: expect.stringContaining('stale seed'),
      }),
    ]);
  });
});
