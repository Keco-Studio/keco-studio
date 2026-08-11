import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('document import UI wiring', () => {
  it('exposes a distinct Import document command in the sidebar add menu', () => {
    const menu = read('src/components/libraries/AddLibraryMenu.tsx');
    expect(menu).toContain('onImportDocument?: () => void');
    expect(menu).toMatch(/onImportDocument[\s\S]*Import new document/);
  });

  it('allows only editors and admins to open the document import modal', () => {
    const sidebar = read('src/components/layout/Sidebar.tsx');
    expect(sidebar).toContain('ImportDocumentModal');
    expect(sidebar).toMatch(
      /dynamic\(\s*\(\) =>\s*import\(["']@\/components\/documents\/ImportDocumentModal["']\)/
    );
    expect(sidebar).not.toMatch(
      /import \{ ImportDocumentModal \} from ["']@\/components\/documents\/ImportDocumentModal["']/
    );
    expect(sidebar).toMatch(
      /onImportDocument=\{[\s\S]*userRole === 'admin' \|\| userRole === 'editor'[\s\S]*handleImportDocument/
    );
    expect(sidebar).toMatch(/<ImportDocumentModal[\s\S]*projectId=\{currentIds\.projectId \|\| ''\}/);
  });

  it('validates and imports through the unified service before reporting success', () => {
    const modal = read('src/components/documents/ImportDocumentModal.tsx');
    expect(modal).toContain('validateDesignFile');
    expect(modal).toContain('createImportedDocument');
    expect(modal).toMatch(/await createImportedDocument[\s\S]*await onImported/);
    expect(modal).toContain('DocumentDropZone');
  });

  it('uses the shared import panel for both documents and tables', () => {
    const documentModal = read('src/components/documents/ImportDocumentModal.tsx');
    const tableModal = read('src/components/libraries/ImportLibraryModal.tsx');
    const sharedModal = read('src/components/shared/ImportResourceModal.tsx');

    expect(documentModal).toContain('<ImportResourceModal');
    expect(documentModal).toContain('resourceLabel="Document"');
    expect(tableModal).toContain('<ImportResourceModal');
    expect(tableModal).toContain('resourceLabel="Table"');
    expect(tableModal).toContain('DocumentDropZone');
    expect(tableModal).toContain('Supported formats: .csv, xlsx, xls');
    expect(sharedModal.indexOf('{resourceLabel} Name')).toBeLessThan(sharedModal.indexOf('>File<'));
    expect(sharedModal.indexOf('>File<')).toBeLessThan(sharedModal.indexOf('>Add notes<'));
    expect(sharedModal).toContain('placeholder="Type..."');
    expect(sharedModal).toContain('Import {resourceKey}');
    expect(sharedModal).toContain('importFieldLabel');
    expect(sharedModal).toContain('importNotesLabelText');
    expect(sharedModal).toContain('importSubmit');
  });

  it('shows a compact File row with Upload button for import dialogs', () => {
    const dropZone = read('src/components/design-upload/DocumentDropZone.tsx');
    const css = read('src/components/design-upload/DocumentDropZone.module.css');
    expect(dropZone).toContain('click to upload');
    expect(dropZone).toContain('Upload');
    expect(dropZone).toContain('formatsHintBelow');
    expect(dropZone).toContain('Drag a file here, or click to choose');
    expect(dropZone).toContain('compactEmptyRow');
    expect(dropZone).toContain('uploadButton');
    expect(dropZone).toContain('DropPlusIcon');
    expect(css).toMatch(/\.zoneCompact\s*\{[^}]*min-height:\s*36px/);
    expect(css).toMatch(/\.uploadButton\s*\{[^}]*#0b99ff/);
    expect(css).toMatch(/\.emptyDrop\s*\{[^}]*background:\s*#f1f5f9/);
    expect(css).toMatch(/\.dropPlusIcon\s*\{[^}]*#94a3b8/);
  });
});
