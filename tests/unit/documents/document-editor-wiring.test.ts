import fs from 'node:fs';
import path from 'node:path';

const editorPath = path.resolve(
  __dirname,
  '../../../src/components/documents/DocumentEditor.tsx'
);

describe('DocumentEditor Phase 1 wiring', () => {
  const source = fs.readFileSync(editorPath, 'utf8');

  it('composes the dedicated session boundaries', () => {
    expect(source).toContain('useDocumentAutosave');
    expect(source).toContain('useDocumentStaleCopy');
    expect(source).toContain('useDocumentPermissions');
    expect(source).toContain('subscribeToProjectDocumentUpdates');
  });

  it('uses the project role API boundary instead of direct role queries', () => {
    expect(source).not.toContain('getUserProjectRole');
    expect(source).not.toContain('getCurrentUserId');
  });

  it('offers explicit stale-copy decisions and updates MDXEditor imperatively', () => {
    expect(source).toContain('Reload remote');
    expect(source).toContain('Keep mine');
    expect(source).toContain('.setMarkdown(');
    expect(source).toContain('styles.staleBanner');
  });

  it('does not retain the inline save-loop implementation', () => {
    expect(source).not.toContain('pendingRef');
    expect(source).not.toContain('savingRef');
    expect(source).not.toContain('PERSIST_DELAY_MS');
  });
});
