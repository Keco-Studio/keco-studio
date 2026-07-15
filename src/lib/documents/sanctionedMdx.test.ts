import { validateSanctionedMdx } from './sanctionedMdx';
import { createSanctionedMdxDescriptors } from './sanctionedMdxDescriptors';
import { DocumentContentValidationError } from './documentStateTypes';

describe('sanctioned MDX validation', () => {
  it('derives editor property metadata and validation from the sanctioned registry', () => {
    const Editor = () => null;
    const descriptors = createSanctionedMdxDescriptors(Editor) as Array<{
      name: string;
      props: Array<{
        name: string;
        required?: boolean;
        allowedValues?: readonly string[];
      }>;
      validateProperties?: (
        values: Record<string, string>,
        previous: Record<string, string>
      ) => Record<string, string> | null;
    }>;
    const callout = descriptors.find(({ name }) => name === 'Callout')!;
    const details = descriptors.find(({ name }) => name === 'Details')!;

    expect(callout.props).toEqual([
      {
        name: 'type',
        type: 'string',
        required: true,
        allowedValues: ['info', 'note', 'warning', 'success'],
      },
      { name: 'title', type: 'string', required: false },
    ]);
    expect(details.props).toEqual([
      { name: 'summary', type: 'string', required: true },
    ]);
    expect(callout.validateProperties?.(
      { type: 'danger', title: 'Changed' },
      { type: 'note', title: 'Original' }
    )).toBeNull();
    expect(details.validateProperties?.(
      { summary: '' },
      { summary: 'Original' }
    )).toBeNull();
    expect(callout.validateProperties?.(
      { type: 'info', title: '   ' },
      { type: 'note', title: 'Original' }
    )).toBeNull();
    expect(callout.validateProperties?.(
      { type: 'success', title: '' },
      { type: 'note', title: 'Original' }
    )).toEqual({ type: 'success', title: '' });
  });

  it('accepts the v1 component registry', () => {
    expect(() => validateSanctionedMdx(
      '# Guide\n\n<Callout type="warning" title="Careful">\n\nRead this.\n\n</Callout>\n\n<Details summary="More">\n\nExtra.\n\n</Details>'
    )).not.toThrow();
  });

  it('accepts sanctioned block components nested in Markdown children', () => {
    expect(() => validateSanctionedMdx(
      '<Details summary="More">\n\n<Callout type="note">\n\nText with <u>underlining</u>.\n\n</Callout>\n\n</Details>'
    )).not.toThrow();
  });

  it.each([
    '<Unknown />',
    '<Callout type="danger">x</Callout>',
    '<Callout type="info" onClick="alert(1)">x</Callout>',
    '<script>alert(1)</script>',
    '[click](javascript:alert(1))',
    '{process.env.SECRET}',
    '<Callout>Missing type</Callout>',
    '<Callout type={kind}>Expression</Callout>',
    '<Callout type="info" tone="loud">Unknown prop</Callout>',
    '<Details summary="One" summary="Two">Duplicate prop</Details>',
    '<Details {...props}>Spread</Details>',
    '<Details summary="Open"><Callout type="note">Wrong close</Details></Callout>',
    '[mail](mailto:test@example.com)',
    '![image](http://example.com/image.png)',
    'export const value = 1',
    'import Component from "./component"',
    '<!-- raw HTML -->',
    '<Callout type="info">Inline block component</Callout>',
    'Text before <Details summary="More">inline</Details> text after.',
    '<u>\n\nBlock underline.\n\n</u>',
    '<u>before\n\n<Callout type="note">nested block</Callout>\n\nafter</u>',
    '<u />',
  ])('rejects unsafe or unsupported content: %s', (content) => {
    expect(() => validateSanctionedMdx(content)).toThrow(DocumentContentValidationError);
  });

  it.each([
    '[click][unsafe]\n\n[unsafe]: javascript:alert(1)',
    '[click][]\n\n[click]: JaVaScRiPt:alert(1)',
    '![image][asset]\n\n[asset]: /projects/123/image.png',
    '[safe][shared]\n\n![unsafe][shared]\n\n[shared]: /projects/123',
  ])('rejects unsafe reference destinations: %s', (content) => {
    expect(() => validateSanctionedMdx(content)).toThrow(DocumentContentValidationError);
  });

  it.each([
    '[control](https://example.com/\u0001path)',
    '[protocol relative](//example.com/path)',
    '![data](data:image/png;base64,AAAA)',
    '[encoded scheme](javascript&#x3A;alert(1))',
  ])('rejects URLs that are unsafe after normalization: %s', (content) => {
    expect(() => validateSanctionedMdx(content)).toThrow(DocumentContentValidationError);
  });

  it.each([
    'Paragraph about import and export workflows.',
    '<u>underlined text</u>',
    '[project](/projects/123)',
    '[secure](https://example.com/path)',
    '![secure image](https://example.com/image.png)',
    '![local image](http://127.0.0.1:54321/storage/v1/object/public/library-media-files/image.png)',
    '![localhost image](http://localhost:54321/storage/v1/object/public/library-media-files/image.png)',
    '[secure reference][docs]\n\n[docs]: HTTPS://example.com/path',
    '[project reference][project]\n\n[project]: /projects/123',
    '![secure reference image][asset]\n\n[asset]: https://example.com/image.png',
    '`<Unknown />`',
    '```tsx\n<Unknown expression={value} />\n```',
  ])('accepts safe Markdown content: %s', (content) => {
    expect(() => validateSanctionedMdx(content)).not.toThrow();
  });
});
