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
});
