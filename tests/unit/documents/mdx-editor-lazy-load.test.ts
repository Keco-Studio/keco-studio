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
  it('keeps the package import inside the dynamically loaded editor module', () => {
    const packageImports = sourceFiles(sourceRoot)
      .filter((file) => fs.readFileSync(file, 'utf8').includes("'@mdxeditor/editor'"))
      .map((file) => path.relative(repoRoot, file))
      .sort();

    expect(packageImports).toEqual([
      'src/components/documents/MdxDocumentEditor.tsx',
      'src/components/documents/documentCollaborationPlugin.ts',
    ]);
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
