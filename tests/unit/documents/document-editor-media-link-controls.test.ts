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

  it('uploads mixed clipboard images before inserting them into editable documents', () => {
    expect(source).toContain('onPasteCapture={handlePasteCapture}');
    expect(source).toContain('if (readOnly) return;');
    expect(source).toContain('extractClipboardImageFiles(event.clipboardData)');
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('uploadClipboardImages(imageFiles, imageUploadHandler)');
    expect(source).toContain('clipboardImagesToMarkdown(images)');
    expect(source).toContain('editorMethodsRef.current?.insertMarkdown(markdown)');
  });

  it('creates a URL-only link from selected text', () => {
    expect(source).not.toMatch(/\bCreateLink\b/);
    expect(source).toContain('currentSelection$');
    expect(source).toContain('linkDialogState$');
    expect(source).toContain('openLinkEditDialog$');
    expect(source).not.toContain('selection?.getTextContent()');
    expect(source).not.toContain("input[name=\"url\"]");
    expect(source).toMatch(/disabled=\{!selection \|\| selection\.isCollapsed\(\)\}/);
    expect(source).toContain('onClick={() => openLinkDialog()}');
    expect(source).toContain('withAnchorText: false');
    expect(source).toMatch(/linkDialogPlugin\(\{ showLinkTitleField: false \}\)/);
  });

  it('opens an editor link in a new tab on double click', () => {
    expect(source).toContain("closest<HTMLAnchorElement>('a[href]')");
    expect(source).toContain("link.getAttribute('href')");
    expect(source).toContain("`https://${href}`");
    expect(source).toContain('registerNodeTransform(LinkNode');
    expect(source).not.toContain('onMouseDown={handleLinkMouseDown}');
    expect(source).not.toContain('onClick={handleLinkClick}');
    expect(source).toContain('onDoubleClick={handleLinkDoubleClick}');
    expect(source).toMatch(/window\.open\(href, '_blank'/);
  });
});
