import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const sourceRoot = path.join(repoRoot, 'src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

describe('MDXEditor route-level lazy loading', () => {
  it('keeps browser and headless package imports behind lazy collaboration boundaries', () => {
    const packageImports = sourceFiles(sourceRoot)
      .filter((file) => fs.readFileSync(file, 'utf8').includes("'@mdxeditor/editor'"))
      .map((file) => path.relative(repoRoot, file))
      .sort();

    expect(packageImports).toEqual([
      'src/components/documents/MdxDocumentEditor.tsx',
      'src/components/documents/ResourceReferenceEditor.tsx',
      'src/components/documents/ResourceReferenceInsertButton.tsx',
      'src/components/documents/documentBlockIdentityPlugin.ts',
      'src/components/documents/documentClipboardImagePastePlugin.tsx',
      'src/components/documents/documentCollaborationPlugin.ts',
      'src/lib/documents/documentBlockIdentity.ts',
      'src/lib/documents/headlessDocumentNodes.ts',
      'src/lib/documents/markdownImageExportPlugin.ts',
    ]);

    const editorShell = fs.readFileSync(
      path.join(sourceRoot, 'components/documents/DocumentEditor.tsx'),
      'utf8'
    );
    const collaborationHook = fs.readFileSync(
      path.join(sourceRoot, 'components/documents/useDocumentCollaboration.ts'),
      'utf8'
    );
    expect(editorShell).not.toContain("from '@/lib/documents/documentStateGateway'");
    expect(editorShell).not.toContain("from '@/lib/documents/documentCollaborationSession'");
    expect(collaborationHook).toContain(
      "import('@/lib/documents/documentCollaborationSession')"
    );
    expect(collaborationHook).toContain(
      "import('@/lib/documents/documentStateGateway')"
    );
  });

  it('loads the editor with next/dynamic and disables SSR', () => {
    const editorShell = fs.readFileSync(
      path.join(sourceRoot, 'components/documents/DocumentEditor.tsx'),
      'utf8'
    );

    expect(editorShell).toMatch(/dynamic<MdxDocumentEditorProps>/);
    expect(editorShell).toMatch(/import\('\.\/MdxDocumentEditor'\)/);
    expect(editorShell).toMatch(/ssr:\s*false/);
  });
});
