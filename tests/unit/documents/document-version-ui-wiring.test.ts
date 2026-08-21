import { readFileSync } from 'node:fs';
import path from 'node:path';

const componentPath = (name: string) =>
  path.join(process.cwd(), 'src/components/documents', name);

describe('document version history UI wiring', () => {
  it('adds a role-aware history surface without library version mutations', () => {
    const editor = readFileSync(componentPath('DocumentEditor.tsx'), 'utf8');
    const topBar = readFileSync(
      path.join(process.cwd(), 'src/components/layout/TopBar.tsx'),
      'utf8'
    );
    const sidebar = readFileSync(
      componentPath('DocumentVersionSidebar.tsx'),
      'utf8'
    );
    // History toggle lives in TopBar and opens the sidebar via a window event.
    expect(topBar).toContain('aria-label="Version history"');
    expect(topBar).toContain('document-history-toggle');
    expect(editor).toContain('document-history-toggle');
    expect(editor).toContain('DocumentVersionSidebar');
    // Sidebar must sit beside the document main column (editor), not
    // inside workspace below stickyChrome — otherwise a blank band appears
    // under the TopBar next to the document editor.
    expect(editor).toContain('documentSectionWithHistory');
    expect(editor).toContain('documentMain');
    expect(editor).toMatch(
      /documentMain[\s\S]*workspace[\s\S]*<\/div>\s*<DocumentVersionSidebar/
    );
    expect(editor).not.toContain('workspaceWithHistory');
    expect(sidebar).toContain('aria-label="Version history"');
    expect(sidebar).toContain('Version History');
    expect(sidebar).toContain('queryKeys.documentVersions(documentId)');
    expect(sidebar).toContain('listDocumentVersions');
    expect(sidebar).toContain('canMutate');
    expect(sidebar).toContain('deleteDocumentVersion');
    expect(sidebar).toContain('canDeleteVersion(entry.version.type)');
    expect(sidebar).toContain("type === 'manual' || type === 'automatic'");
    expect(sidebar).toContain('Modal.confirm');
    expect(sidebar).toContain('selectedVersionId');
    expect(sidebar).toContain('onVersionSelect');
    expect(sidebar).toContain('aria-label="Create version"');
    expect(sidebar).toContain('DocumentVersionItem');
    expect(sidebar).not.toContain('@/lib/services/versionService');
    expect(sidebar).not.toContain('library_versions');
    const item = readFileSync(componentPath('DocumentVersionItem.tsx'), 'utf8');
    expect(item).toContain('with Keco Agent');
    expect(item).not.toContain('modified by keco agent');
    expect(item).toContain('Current Version');
  });

  it('wires inline historical preview selection from the editor', () => {
    const editor = readFileSync(componentPath('DocumentEditor.tsx'), 'utf8');
    expect(editor).toContain('selectedVersionId');
    expect(editor).toContain('onVersionSelect');
    expect(editor).toContain('getDocumentVersionPreview');
    expect(editor).toMatch(/readOnly[\s\S]*selectedVersionId|selectedVersionId[\s\S]*readOnly/);
    expect(editor).toContain('Viewing version');
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
    const item = readFileSync(componentPath('DocumentVersionItem.tsx'), 'utf8');
    expect(create).toContain('await session.flush()');
    expect(create).toContain('createDocumentVersion');
    expect(restore).toContain('session.restoreVersion(version.id)');
    expect(restore).toContain('backup');
    expect(restore).toMatch(
      /const handleCancel = \(\) => \{\s*if \(submitting\) return;\s*onClose\(\);\s*\}/
    );
    expect(restore).toContain('onCancel={handleCancel}');
    expect(restore).toContain('cancelButtonProps={{ disabled: submitting }}');
    expect(restore).toContain('maskClosable={!submitting}');
    expect(restore).toContain('closable={!submitting}');
    expect(restore).toContain('keyboard={!submitting}');
    expect(restore).toContain(
      'okButtonProps={{ danger: true, disabled: submitting }}'
    );
    expect(restore).toContain('confirmLoading={submitting}');
    expect(item).toContain('modified by');
    expect(item).toContain('onSelect');
    expect(item).toContain('onRestore');
  });
});
