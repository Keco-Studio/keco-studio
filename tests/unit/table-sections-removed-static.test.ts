import { existsSync, readFileSync } from 'node:fs';

const tablePath = 'src/components/libraries/LibraryAssetsTable.tsx';
const pagePath = 'src/app/(dashboard)/[projectId]/[libraryId]/page.tsx';
const cssPath = 'src/components/libraries/LibraryAssetsTable.module.css';

describe('table section removal boundary', () => {
  it('removes section controls and active-section state from the table', () => {
    const table = readFileSync(tablePath, 'utf8');
    const page = readFileSync(pagePath, 'utf8');
    const css = readFileSync(cssPath, 'utf8');

    expect(existsSync('src/components/libraries/components/SectionTabs.tsx')).toBe(false);
    expect(existsSync('src/components/libraries/hooks/useLibrarySectionEditing.ts')).toBe(false);
    expect(table).not.toMatch(/activeSection|onAddSection|onUpdateSection|onDeleteSection|sectionDeleteConfirm/);
    expect(page).not.toMatch(/handleAddSection|handleUpdateSection|handleDeleteSection|tableSections/);
    expect(css).not.toMatch(/\.sectionTabs|\.sectionTab|\.addSectionButton/);
  });
});
