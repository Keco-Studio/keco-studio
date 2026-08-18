import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('derived Script Table synchronization wiring', () => {
  it('passes source metadata into the Table adapter', () => {
    const page = readFileSync(resolve(
      process.cwd(),
      'src/app/(dashboard)/[projectId]/[libraryId]/page.tsx',
    ), 'utf8');
    expect(page).toContain('sourceDocumentId: library.source_document_id');
  });

  it('routes Table edits, inserts, and deletes through Script synchronization plans', () => {
    const adapter = readFileSync(resolve(
      process.cwd(),
      'src/components/libraries/LibraryAssetsTableAdapter.tsx',
    ), 'utf8');
    expect(adapter).toContain('planScriptDialogueTableEdit');
    expect(adapter).toContain('planScriptDialogueTableInsert');
    expect(adapter).toContain('planScriptDialogueTableDelete');
    expect(adapter).toContain('synchronizeScriptDialogueTablePlan');
  });
});
