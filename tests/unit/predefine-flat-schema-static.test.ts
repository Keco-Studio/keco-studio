import { existsSync, readFileSync } from 'node:fs';

const pagePath = 'src/app/(dashboard)/[projectId]/[libraryId]/predefine/page.tsx';
const savePath = 'src/app/(dashboard)/[projectId]/[libraryId]/predefine/hooks/useSchemaSave.ts';
const topBarPath = 'src/components/layout/TopBar.tsx';

describe('flat Predefine schema editor', () => {
  it('keeps field editing while removing section tabs and state', () => {
    const page = readFileSync(pagePath, 'utf8');
    const save = readFileSync(savePath, 'utf8');
    const topBar = readFileSync(topBarPath, 'utf8');

    expect(existsSync('src/app/(dashboard)/[projectId]/[libraryId]/predefine/components/NewSectionForm.tsx')).toBe(false);
    expect(page).toContain('FieldForm');
    expect(page).toMatch(/handleSaveField|handleFieldChange|handleDeleteField/);
    expect(page).not.toMatch(/Tabs|activeSection|NewSection|Add Section/);
    expect(save).toMatch(/fieldsToSave|FlatField/);
    expect(save).not.toMatch(/sectionsToSave|section\.name|sectionId/);
    expect(topBar).not.toMatch(/predefineActiveSection|Delete Section|predefine-state/);
  });
});
