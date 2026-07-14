import { readFileSync } from 'node:fs';
import path from 'node:path';

const componentPath = (name: string) =>
  path.join(process.cwd(), 'src/components/documents', name);

describe('document version history UI wiring', () => {
  it('adds a role-aware history surface without library version mutations', () => {
    const editor = readFileSync(componentPath('DocumentEditor.tsx'), 'utf8');
    const sidebar = readFileSync(
      componentPath('DocumentVersionSidebar.tsx'),
      'utf8'
    );
    expect(editor).toContain('aria-label="Version history"');
    expect(editor).toContain('DocumentVersionSidebar');
    expect(sidebar).toContain('queryKeys.documentVersions(documentId)');
    expect(sidebar).toContain('listDocumentVersions');
    expect(sidebar).toContain('canMutate');
    expect(sidebar).not.toContain('@/lib/services/versionService');
    expect(sidebar).not.toContain('library_versions');
  });

  it('flushes before create and gates create/restore while retaining viewer preview', () => {
    const create = readFileSync(
      componentPath('CreateDocumentVersionModal.tsx'),
      'utf8'
    );
    const restore = readFileSync(
      componentPath('RestoreDocumentVersionModal.tsx'),
      'utf8'
    );
    const preview = readFileSync(
      componentPath('DocumentVersionPreviewModal.tsx'),
      'utf8'
    );
    expect(create).toContain('await session.flush()');
    expect(create).toContain('createDocumentVersion');
    expect(restore).toContain('session.restoreVersion(version.id)');
    expect(restore).toContain('backup');
    expect(preview).toContain('readOnly');
    expect(preview).toContain('showToolbar={false}');
    expect(preview).toContain('markdown={version.markdown}');
  });
});
