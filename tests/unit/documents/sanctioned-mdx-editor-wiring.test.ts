import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('sanctioned MDX editor wiring', () => {
  it('uses an inert nested editor instead of a component-name placeholder', () => {
    const descriptors = source('src/lib/documents/sanctionedMdxDescriptors.tsx');
    const editor = source('src/components/documents/MdxDocumentEditor.tsx');

    expect(descriptors).toContain('createSanctionedMdxDescriptors');
    expect(descriptors).not.toContain('data-mdx-component');
    expect(editor).toContain('GenericJsxEditor');
    expect(editor).toContain('SanctionedMdxEditor');
    expect(editor).toContain('SanctionedMdxPropertyEditor');
    expect(editor).toContain('PropertyEditor={BoundSanctionedMdxPropertyEditor}');
    expect(editor).toContain('styles.sanctionedMdx');
    expect(editor).toContain("descriptor.name === 'BlockAnchor'");
    expect(editor).toContain("descriptor.name === 'ResourceReference'");
    expect(editor).toContain('<ResourceReferenceEditor');
    expect(editor).toContain('<ResourceReferenceProvider key={documentId} projectId={projectId}>');
  });

  it('derives descriptors from the shared registry without redeclaring props', () => {
    const descriptors = source('src/lib/documents/sanctionedMdxDescriptors.tsx');

    expect(descriptors).toContain('SANCTIONED_MDX_REGISTRY');
    expect(descriptors).not.toMatch(/name:\s*['"](?:type|title|summary)['"]/);
  });

  it('reuses the descriptor factory in the headless codec boundary', () => {
    const headless = source('src/lib/documents/headlessDocumentNodes.ts');

    expect(headless).toContain('createSanctionedMdxDescriptors');
    expect(headless).toContain('GenericJsxEditor');
  });

  it('specializes only inert anchors and live resource references', () => {
    const editor = source('src/components/documents/MdxDocumentEditor.tsx');

    expect(editor).toMatch(
      /descriptor\.name === 'BlockAnchor'[\s\S]*Editor: \(\) => null/
    );
    expect(editor).toMatch(
      /descriptor\.name === 'ResourceReference'[\s\S]*Editor: ResourceReference/
    );
    expect(editor).toMatch(
      /function SanctionedMdxEditor[\s\S]*<GenericJsxEditor/
    );
    expect(editor).not.toContain("descriptor.name === 'Callout'");
    expect(editor).not.toContain("descriptor.name === 'Details'");
    expect(editor).toMatch(
      /<ResourceReferenceEditor[\s\S]*readOnly=\{readOnly\}/
    );
    expect(editor).not.toContain('onReplaceResourceReference');
    expect(editor).not.toContain('openReplacement');
  });

  it('passes project, document, and viewer context through live and preview editors', () => {
    const documentEditor = source('src/components/documents/DocumentEditor.tsx');
    const preview = source('src/components/documents/DocumentVersionPreviewModal.tsx');
    const sidebar = source('src/components/documents/DocumentVersionSidebar.tsx');
    const liveEditorCalls = documentEditor.match(/<MdxDocumentEditor\s[\s\S]*?\/>/g);

    // Live collaborative editor, live read-only fallback, and historical version preview.
    expect(liveEditorCalls).toHaveLength(3);
    liveEditorCalls?.forEach((call) => {
      expect(call).toContain('projectId={projectId}');
      expect(call).toContain('documentId={document.id}');
    });
    expect(documentEditor).toContain('readOnly={collaboration.readOnly}');
    expect(documentEditor).toContain('historicalMarkdown');
    expect(preview).toContain('projectId={projectId}');
    expect(preview).toContain('documentId={documentId}');
    expect(preview).toMatch(/<MdxDocumentEditor[\s\S]*readOnly/);
    expect(sidebar).toContain('projectId');
    expect(sidebar).toContain('documentId');
    expect(documentEditor).toMatch(
      /<DocumentVersionSidebar[\s\S]*projectId=\{projectId\}[\s\S]*documentId=\{document\.id\}/
    );
  });
});
