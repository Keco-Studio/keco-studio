import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Studio Open script transition page', () => {
  it('shows the source document while orchestration runs, then replaces the route', () => {
    const source = read('src/app/(dashboard)/script-system/[projectId]/open/[documentId]/page.tsx');
    const shell = read('src/components/script-system/ScriptShell.tsx');

    expect(source).toContain('openScriptFromStudio');
    expect(source).toContain('router.replace');
    expect(source).toContain("import { DocumentEditor }");
    expect(source).toContain('<DocumentEditor');
    expect(source).toContain('documentId={documentId}');
    expect(source).toContain('flushLayout');
    expect(source).toContain('runDocumentDerivedImport');
    expect(source).not.toContain('statusOverlay');
    expect(source).not.toContain('Generating conversation');
    expect(source).toContain('activeAttemptRef');
    expect(shell).toContain('pathname?.includes(`/script-system/${projectId}/open/`)');
  });
});
