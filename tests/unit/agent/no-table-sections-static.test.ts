import { readFileSync } from 'node:fs';

describe('flat Agent table contracts', () => {
  it('does not expose active table sections', () => {
    const addField = readFileSync('src/lib/agent/tools/add-field.ts', 'utf8');
    const listStructure = readFileSync('src/lib/agent/tools/list-project-structure.ts', 'utf8');
    const context = readFileSync('src/components/agent/ChatPanel.tsx', 'utf8');

    expect(addField).not.toMatch(/sectionName|section tab|active section/i);
    expect(listStructure).not.toMatch(/sectionIds|sections:|sectionNameFromId|sectionId/);
    expect(context).not.toMatch(/currentSectionName|active-section|getActiveSectionName/);
  });
});
