import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/layout/Sidebar.tsx'),
  'utf8'
);

describe('document rename cache wiring', () => {
  it('keeps the open document detail aligned with the renamed sidebar entry', () => {
    const renameBranch = source.slice(
      source.indexOf("} else if (key.startsWith('document-'))"),
      source.indexOf("      } catch (err: unknown)")
    );

    expect(renameBranch).toContain('queryKeys.documents(currentIds.projectId)');
    expect(renameBranch).toContain('queryKeys.document(id)');
    expect(renameBranch).toMatch(/setQueryData<DocumentRecord>/);
    expect(renameBranch).toMatch(
      /invalidateQueries\(\{ queryKey: queryKeys\.document\(id\) \}\)/
    );
  });
});
