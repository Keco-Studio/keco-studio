import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/documents/MdxDocumentEditor.tsx'),
  'utf8'
);

describe('document editor media and link controls', () => {
  it('inserts one selected image file without the default metadata dialog', () => {
    expect(source).not.toMatch(/\bInsertImage\b/);
    expect(source).toContain('type="file"');
    expect(source).toContain('accept="image/*"');
    expect(source).not.toContain('multiple');
    expect(source).toMatch(/insertImage\(\{ file, altText: '' \}\)/);
  });

  it('creates a URL-only link from selected text', () => {
    expect(source).not.toMatch(/\bCreateLink\b/);
    expect(source).toContain('currentSelection$');
    expect(source).toContain('openLinkEditDialog$');
    expect(source).toMatch(/disabled=\{!selection \|\| selection\.isCollapsed\(\)\}/);
    expect(source).toMatch(/linkDialogPlugin\(\{ showLinkTitleField: false \}\)/);
  });

  it('opens an editor link on double click', () => {
    expect(source).toContain("closest<HTMLAnchorElement>('a[href]')");
    expect(source).toContain('onDoubleClick={handleLinkDoubleClick}');
    expect(source).toMatch(/window\.open\(href, '_blank'/);
  });
});
