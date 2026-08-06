import fs from 'node:fs';
import path from 'node:path';

const editorPath = path.resolve(
  __dirname,
  '../../../src/components/documents/DocumentEditor.tsx'
);

describe('DocumentEditor collaboration wiring', () => {
  const source = fs.readFileSync(editorPath, 'utf8');

  it('uses collaboration and permission boundaries without mounting Phase 1 writers', () => {
    expect(source).toContain('useDocumentCollaboration');
    expect(source).toContain('useDocumentPermissions');
    expect(source).not.toContain('useDocumentAutosave');
    expect(source).not.toContain('useDocumentStaleCopy');
    expect(source).not.toContain('updateDocumentContent');
    expect(source).not.toContain('keepalive: true');
  });

  it('uses the project role API boundary instead of direct role queries', () => {
    expect(source).not.toContain('getUserProjectRole');
    expect(source).not.toContain('getCurrentUserId');
  });

  it('starts permission loading from the route project and avoids forced focus refetches', () => {
    expect(source).toContain('projectId,');
    expect(source).toContain('documentProjectId: document?.project_id ?? null');
    expect(source).not.toContain('refetchOnWindowFocus: true');
    expect(source).toContain('refetchOnMount: true');
    expect(source).toContain('scriptWorkspaceMembershipReady');
  });

  it('passes one session to the dynamically loaded editor and remounts by epoch', () => {
    expect(source).toContain('collaboration.session');
    expect(source).toContain('cursorColor: collaboration.cursorColor');
    expect(source).toContain('collaboration.token.epoch');
    expect(source).toContain('key={editorKey}');
    expect(source).not.toContain('provider:');
    expect(source).not.toContain('doc:');
  });

  it('keeps the editor read-only unless the collaborative session is ready for an editor', () => {
    expect(source).toContain('collaboration.readOnly');
    expect(source).toContain('collaboration.canBind');
    expect(source).toContain('collaboration.isLegacyView');
  });

  it('shows the current document read-only while collaboration is connecting', () => {
    expect(source).toContain("markdown={document.content ?? ''}");
    expect(source).toContain('showToolbar={false}');
    expect(source).toContain('collaboration.canBind && collaboration.session');
    expect(source).toContain('key={`${document.id}:pending`');
  });

  it('renders fail-closed recovery without stale-copy decisions', () => {
    expect(source).toContain('collaboration.canRetry');
    expect(source).toContain('collaboration.retry');
    expect(source).not.toContain('Reload remote');
    expect(source).not.toContain('Keep mine');
  });
});
