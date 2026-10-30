import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('folder/recent cards and project modal visual contracts', () => {
  it('uses the page for vertical scrolling and keeps a sticky horizontal scrollbar', () => {
    const source = read('src/components/libraries/LibraryAssetsTable.module.css');
    const table = read('src/components/libraries/LibraryAssetsTable.tsx');

    expect(source).toMatch(/\.tableContainer\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s);
    expect(source).not.toMatch(/\.tableContainer\s*\{[^}]*max-height:/s);
    expect(source).toMatch(
      /\.stickyHorizontalScrollbar\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s,
    );
    expect(table).toContain('<StickyHorizontalScrollbar');
    expect(table).toContain('scrollContainerRef={tableContainerRef}');
    expect(table).toContain('knownOverflow={useCustomColumnWidths ? undefined : autoTableHasOverflow}');
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

  it('uses the same 2rem action button on table and document cards', () => {
    const tableCard = read('src/components/folders/LibraryCard.module.css');
    const documentCard = read('src/components/admin/DocumentRecentCard.module.css');

    for (const source of [tableCard, documentCard]) {
      expect(source).toMatch(/\.actionButton\s*\{[^}]*width:\s*2rem;[^}]*height:\s*2rem;/s);
    }
  });

  it('uses the table card blue action-button states on document cards', () => {
    const documentCard = read('src/components/admin/DocumentRecentCard.module.css');

    expect(documentCard).toMatch(
      /\.actionButton:hover\s*\{[^}]*background-color:\s*#0B99FF;[^}]*border-color:\s*#D1D5DB;/s,
    );
    expect(documentCard).toMatch(/\.actionButton:hover img\s*\{[^}]*filter:\s*brightness\(0\) invert\(1\);/s);
    expect(documentCard).toMatch(/\.actionButton:active\s*\{[^}]*background-color:\s*#0B99FF;/s);
    expect(documentCard).toMatch(/\.actionButton:active img\s*\{[^}]*filter:\s*brightness\(0\) invert\(1\);/s);
  });

  it('keeps the expanded Create Project dialog responsive and scrollable', () => {
    const dialog = read('src/components/shared/FormDialog.module.css');
    expect(dialog).toMatch(/\.projectModal\s*\{[^}]*width:\s*min\(46rem,\s*calc\(100vw - 2rem\)\);/s);
    expect(dialog).toMatch(/\.projectModal\s*\{[^}]*max-height:\s*calc\(100vh - 2rem\);/s);
    expect(dialog).toMatch(/\.projectModal\s*\{[^}]*border-radius:\s*14px;/s);

    const modal = read('src/components/projects/NewProjectModal.tsx');
    expect(modal).toContain('dialog.projectModal');
    expect(modal).toContain('styles.body');
  });

  it('keeps GDS tag limits while project Foundation fields omit maxLength', () => {
    const gds = read('src/components/game-design-system/GameDesignSystemCreatePage.tsx');
    expect(gds).toMatch(/id="gds-genres"[^>]*maxLength=\{80\}/);
    expect(gds).toMatch(/id="gds-philosophies"[^>]*maxLength=\{120\}/);

    const projectFields = read('src/components/projects/ProjectFoundationFields.tsx');
    expect(projectFields).not.toContain('maxLength');
  });
});
