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

describe('document collaboration React boundary', () => {
  it('maps every connection state to a fail-closed editor presentation', async () => {
    const { getDocumentCollaborationPresentation } = await import(
      '@/components/documents/useDocumentCollaboration'
    );

    expect(getDocumentCollaborationPresentation('authorizing', 'editor')).toMatchObject({
      label: 'Authorizing...',
      readOnly: true,
      canBind: false,
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
    expect(source).toContain('broadcastProjectDocumentUpdate');
    expect(queryKeys).toContain('documentState: (id: string)');
    expect(queryKeys).toContain('documentVersions: (id: string)');
  });

  it('uses the authorized private project sidebar channel', () => {
    const source = readFileSync(sidebarRealtimePath, 'utf8');
    expect(source).toContain('projectSidebarTopic(currentProjectId), {');
    expect(source).toContain('private: true');
  });
});
