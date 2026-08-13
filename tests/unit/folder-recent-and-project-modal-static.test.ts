import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('folder/recent cards and project modal visual contracts', () => {
  it('keeps the table scrollbars inside the viewport-sized table region', () => {
    const source = read('src/components/libraries/LibraryAssetsTable.module.css');
    expect(source).toMatch(/\.tableContainer\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*auto;/s);
    expect(source).toMatch(/\.tableContainer\s*\{[^}]*max-height:\s*calc\(100vh\s*-/s);
  });

  it('loads and renders folder documents alongside libraries', () => {
    const source = read('src/app/(dashboard)/[projectId]/folder/[folderId]/page.tsx');
    expect(source).toContain("import { listDocuments, type DocumentSummary } from '@/lib/services/documentService';");
    expect(source).toContain('document.folder_id === folderId');
    expect(source).toContain('DocumentRecentCard');
    expect(source).toContain('documents.map');
    expect(source).toContain('documents={documents}');
    expect(source).toContain("import { filterStudioLibraries } from '@/lib/studioLibraryIsolation';");
    expect(source).toContain('filterStudioLibraries(await listLibraries');

    const listView = read('src/components/folders/LibraryListView.tsx');
    expect(listView).toContain('documents?: DocumentSummary[];');
    expect(listView).toContain("type: 'document'");
    expect(listView).toContain('onDocumentClick');
  });

  it('uses a gray 24px icon wrapper on table and document cards', () => {
    const tableCard = read('src/components/folders/LibraryCard.module.css');
    const documentCard = read('src/components/admin/DocumentRecentCard.module.css');
    for (const source of [tableCard, documentCard]) {
      expect(source).toMatch(/width:\s*24px;/);
      expect(source).toMatch(/height:\s*24px;/);
      expect(source).toContain('border-radius: 5px;');
      expect(source).toContain('background: #EEEEEE;');
    }
  });

  it('matches the Create Project dialog size and disabled helper text color', () => {
    const dialog = read('src/components/shared/FormDialog.module.css');
    expect(dialog).toMatch(/\.projectModal\s*\{[^}]*width:\s*616px;[^}]*height:\s*370px;/s);
    expect(dialog).toMatch(/\.projectModal\s*\{[^}]*border-radius:\s*14px;/s);
    expect(dialog).toMatch(/\.notesLabelLimit\s*\{[^}]*color:\s*var\(--text-disabled,\s*#0000003D\);/s);

    const modal = read('src/components/projects/NewProjectModal.tsx');
    expect(modal).toContain('dialog.projectModal');
  });
});
