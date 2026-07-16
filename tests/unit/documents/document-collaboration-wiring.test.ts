import { readFileSync } from 'node:fs';
import path from 'node:path';

const hookPath = path.join(
  process.cwd(),
  'src/components/documents/useDocumentCollaboration.ts'
);
const queryKeysPath = path.join(process.cwd(), 'src/lib/utils/queryKeys.ts');
const sidebarRealtimePath = path.join(
  process.cwd(),
  'src/components/layout/hooks/useSidebarRealtime.ts'
);
const editorPath = path.join(
  process.cwd(),
  'src/components/documents/MdxDocumentEditor.tsx'
);

describe('document collaboration React boundary', () => {
  it('registers a higher-priority synced CodeMirror editor descriptor', () => {
    const source = readFileSync(editorPath, 'utf8');
    expect(source).toContain('Editor: SyncedCodeMirrorEditor');
    expect(source).toContain('priority: 2');
    expect(source).toContain('EditorView.findFromDOM');
  });

  it('replaces only the changed UTF-16 range without adding remote sync to undo history', async () => {
    const { Transaction } = await import('@codemirror/state');
    const { syncCodeMirrorDocument } = await import(
      '@/components/documents/codeMirrorDocumentSync'
    );
    const dispatch = jest.fn();
    const current = 'const emoji = "😀old";\n';
    const view = {
      state: {
        doc: {
          length: current.length,
          toString: () => current,
        },
      },
      dispatch,
    };

    expect(syncCodeMirrorDocument(view, 'const emoji = "😀fresh";\n')).toBe(
      true
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      changes: { from: 17, to: 20, insert: 'fresh' },
    });
    const annotation = dispatch.mock.calls[0]?.[0].annotations;
    expect(annotation.type).toBe(Transaction.addToHistory);
    expect(annotation.value).toBe(false);
  });

  it('does not dispatch when CodeMirror already contains the incoming code', async () => {
    const { syncCodeMirrorDocument } = await import(
      '@/components/documents/codeMirrorDocumentSync'
    );
    const dispatch = jest.fn();
    const view = {
      state: {
        doc: {
          length: 12,
          toString: () => 'local typing',
        },
      },
      dispatch,
    };

    expect(syncCodeMirrorDocument(view, 'local typing')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('maps complete Lexical awareness states to unique remote collaborators', async () => {
    const { getDocumentCollaborators } = await import(
      '@/components/documents/useDocumentCollaboration'
    );
    const states = new Map<number, unknown>([
      [
        1,
        {
          name: 'Local editor',
          color: '#1677ff',
          focusing: true,
          awarenessData: { userId: 'local-user' },
        },
      ],
      [
        2,
        {
          name: 'Remote editor',
          color: '#52c41a',
          focusing: false,
          awarenessData: { userId: 'remote-user' },
        },
      ],
      [
        3,
        {
          name: 'Remote editor duplicate',
          color: '#faad14',
          focusing: true,
          awarenessData: { userId: 'remote-user' },
        },
      ],
      [
        4,
        {
          color: '#722ed1',
          focusing: true,
          awarenessData: { userId: 'missing-name' },
        },
      ],
      [
        5,
        {
          name: 'Missing color',
          focusing: true,
          awarenessData: { userId: 'missing-color' },
        },
      ],
      [
        6,
        {
          name: 'Missing focus state',
          color: '#eb2f96',
          awarenessData: { userId: 'missing-focus' },
        },
      ],
      [
        7,
        {
          name: 'Missing identity',
          color: '#13c2c2',
          focusing: true,
          awarenessData: {},
        },
      ],
    ]);

    expect(getDocumentCollaborators(states, 'local-user')).toEqual([
      { id: 'remote-user', name: 'Remote editor', color: '#52c41a' },
    ]);
  });

  it('maps every connection state to a fail-closed editor presentation', async () => {
    const { getDocumentCollaborationPresentation } = await import(
      '@/components/documents/useDocumentCollaboration'
    );

    expect(getDocumentCollaborationPresentation('authorizing', 'editor')).toMatchObject({
      label: 'Authorizing...',
      readOnly: true,
      canBind: true,
    });
    expect(getDocumentCollaborationPresentation('connecting', 'editor')).toMatchObject({
      label: 'Connecting...',
      readOnly: true,
      canBind: true,
    });
    expect(getDocumentCollaborationPresentation('syncing', 'editor')).toMatchObject({
      label: 'Syncing...',
      readOnly: true,
      canBind: true,
    });
    expect(getDocumentCollaborationPresentation('ready', 'editor')).toMatchObject({
      label: 'Live',
      readOnly: false,
      canBind: true,
    });
    expect(getDocumentCollaborationPresentation('ready', 'viewer')).toMatchObject({
      label: 'View only - Live',
      readOnly: true,
      canBind: true,
    });
    expect(getDocumentCollaborationPresentation('legacy-view', 'viewer')).toMatchObject({
      readOnly: true,
      canBind: false,
      isLegacyView: true,
    });
    expect(getDocumentCollaborationPresentation('degraded', 'editor')).toMatchObject({
      readOnly: true,
      canRetry: true,
    });
    expect(getDocumentCollaborationPresentation('error', 'editor')).toMatchObject({
      readOnly: true,
      canRetry: true,
    });
  });

  it('owns one durable session lifecycle, token refresh, flush, and unload guard', () => {
    const source = readFileSync(hookPath, 'utf8');
    expect(source).toContain('new DocumentCollaborationSession');
    expect(source).toContain('session.subscribe');
    expect(source).toContain('session.connect()');
    expect(source).toContain('nextSession.destroy()');
    expect(source).toContain('.updateAccessToken(authSession.access_token)');
    expect(source).toContain('registerDocumentFlushHandler');
    expect(source).toContain('session.flush()');
    expect(source).toContain("addEventListener('beforeunload'");
    expect(source).toContain("addEventListener('focus', recover)");
    expect(source).toContain("addEventListener('online', recover)");
    expect(source).toContain("document.visibilityState === 'visible'");
    expect(source).toContain('session.recoverNow()');
    expect(source).toContain("removeEventListener('focus', recover)");
    expect(source).toContain("removeEventListener('online', recover)");
    expect(source).not.toContain('const refresh = () =>');
    expect(source).toContain('session.hasPendingChanges');
    expect(source).toContain('cursorColor');
    expect(source).toContain('setLoadFailure');
    expect(source.indexOf("if (status === 'error')")).toBeLessThan(
      source.indexOf('if (!session) return;', source.indexOf('const retry'))
    );
  });

  it('broadcasts only successful compaction metadata and exposes state query keys', () => {
    const source = readFileSync(hookPath, 'utf8');
    const queryKeys = readFileSync(queryKeysPath, 'utf8');
    expect(source).toContain('onCompacted');
    expect(source).toContain('onStateReplaced');
    expect(source).toContain('broadcastProjectDocumentUpdate');
    expect(source).toContain('queryKeys.documentVersions(documentId)');
    expect(queryKeys).toContain('documentState: (id: string)');
    expect(queryKeys).toContain('documentVersions: (id: string)');
  });

  it('uses the authorized private project sidebar channel', () => {
    const source = readFileSync(sidebarRealtimePath, 'utf8');
    expect(source).toContain('projectSidebarTopic(currentProjectId), {');
    expect(source).toContain('private: true');
  });
});
