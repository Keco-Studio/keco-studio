import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Keco Script doc route guard + DocumentEditor', () => {
  it('useScriptWorkspaceMembership fetches workspace list and exposes isMember', () => {
    const source = read(
      'src/components/script-system/useScriptWorkspaceMembership.ts'
    );
    expect(source).toContain('useQuery');
    expect(source).toContain('/api/script-workspace/');
    expect(source).toMatch(/isMember\s*[:=(]/);
    expect(source).toMatch(/documentId/);
    expect(source).toContain('staleTime: 0');
    expect(source).toContain("refetchOnMount: 'always'");
  });

  it('doc page embeds DocumentEditor with projectId and documentId', () => {
    const source = read(
      'src/app/(dashboard)/script-system/[projectId]/doc/[documentId]/page.tsx'
    );
    expect(source).toContain('DocumentEditor');
    expect(source).toContain('key={documentId}');
    expect(source).toContain('projectId={projectId}');
    expect(source).toContain('documentId={documentId}');
    expect(source).not.toMatch(/editor coming soon|DocumentDocumentPageStub|stub/i);
  });

  it('doc page guards membership and redirects non-members with toast', () => {
    const source = read(
      'src/app/(dashboard)/script-system/[projectId]/doc/[documentId]/page.tsx'
    );
    expect(source).toContain('useScriptWorkspaceMembership');
    expect(source).toMatch(/isMember/);
    expect(source).toMatch(/router\.(replace|push)/);
    expect(source).toContain(`/script-system/\${projectId}`);
    expect(source).toMatch(/showErrorToast|showWarningToast|showInfoToast/);
  });
});
