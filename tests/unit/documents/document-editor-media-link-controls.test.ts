import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/documents/MdxDocumentEditor.tsx'),
  'utf8'
);
const clipboardPluginSource = readFileSync(
  path.join(
    process.cwd(),
    'src/components/documents/documentClipboardImagePastePlugin.tsx'
  ),
  'utf8'
);
const editorStyles = readFileSync(
  path.join(process.cwd(), 'src/components/documents/MdxDocumentEditor.module.css'),
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

  it('inserts mixed clipboard images through the native editor image pipeline', () => {
    expect(clipboardPluginSource).toContain('addComposerChild$');
    expect(clipboardPluginSource).toContain('PASTE_COMMAND');
    expect(clipboardPluginSource).toContain('insertImage$');
    expect(clipboardPluginSource).toContain('$createImageNode');
    expect(clipboardPluginSource).toContain('SKIP_DOM_SELECTION_TAG');
    expect(clipboardPluginSource).toContain('pasteSelection');
    expect(clipboardPluginSource).toContain('currentSelection');
    expect(clipboardPluginSource).toContain('rootHadFocus');
    expect(clipboardPluginSource).toContain('editor.isEditable()');
    expect(clipboardPluginSource).toContain('event.preventDefault()');
    expect(clipboardPluginSource).toContain(
      'uploadClipboardImages(imageFiles, imageUploadHandler)'
    );
    expect(clipboardPluginSource).toContain(
      "insertImage({ src: image.url, altText: image.file.name })"
    );
    expect(source).toContain(
      'documentClipboardImagePastePlugin({ imageUploadHandler })'
    );
    expect(source).not.toContain('onPasteCapture={handlePasteCapture}');
    expect(source).not.toContain('insertMarkdown(markdown)');
    expect(source).not.toContain('clipboardImagesToMarkdown');
    expect(source).toContain('inert={readOnly}');
  });

  it('keeps oversized images inside the editable document width', () => {
    expect(editorStyles).toContain("[data-editor-block-type='image']");
    expect(editorStyles).toContain('max-width: 100%');
    expect(editorStyles).toContain('height: auto');
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
