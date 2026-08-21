import { validateSanctionedMdx, coerceSanctionedMdxImages, coerceSanctionedMdxHtmlComments } from './sanctionedMdx';
import { createSanctionedMdxDescriptors } from './sanctionedMdxDescriptors';
import { DocumentContentValidationError } from './documentStateTypes';
import {
  parseResourceReferenceAttributes,
  resourceReferenceAttributes,
  resourceReferenceKey,
  type ResourceReferenceTarget,
} from './resourceReferenceTypes';

const REFERENCE_TARGETS: ResourceReferenceTarget[] = [
  {
    kind: 'table-row',
    libraryId: '11111111-1111-4111-8111-111111111111',
    assetId: '22222222-2222-4222-8222-222222222222',
    displayFieldId: '33333333-3333-4333-8333-333333333333',
    fallbackLabel: 'Ada',
  },
  {
    kind: 'document-block',
    documentId: '44444444-4444-4444-8444-444444444444',
    blockId: '55555555-5555-4555-8555-555555555555',
    blockType: 'paragraph',
    fallbackLabel: 'The city closes its gates',
  },
  {
    kind: 'document-range',
    documentId: '44444444-4444-4444-8444-444444444444',
    startBlockId: '55555555-5555-4555-8555-555555555555',
    startOffset: 4,
    startBefore: 'The ',
    startAfter: 'city closes',
    endBlockId: '77777777-7777-4777-8777-777777777777',
    endOffset: 9,
    endBefore: 'at dawn. ',
    endAfter: 'Guards wait.',
    fallbackLabel: 'city closes its gates at dawn.',
  },
];

describe('resource reference targets', () => {
  it.each([
    [
      REFERENCE_TARGETS[0],
      'table-row:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333',
    ],
    [
      REFERENCE_TARGETS[1],
      'document-block:44444444-4444-4444-8444-444444444444:55555555-5555-4555-8555-555555555555',
    ],
  ])('round-trips attributes with a stable key', (target, expectedKey) => {
    const attributes = resourceReferenceAttributes(target);

    expect(parseResourceReferenceAttributes(attributes)).toEqual(target);
    expect(resourceReferenceKey(target)).toBe(expectedKey);
  });

  it('round-trips a document range with a key that changes with its boundaries', () => {
    const target = REFERENCE_TARGETS[2];
    const moved = target.kind === 'document-range'
      ? { ...target, startOffset: target.startOffset + 1 }
      : target;

    expect(parseResourceReferenceAttributes(resourceReferenceAttributes(target)))
      .toEqual(target);
    expect(resourceReferenceKey(target)).toMatch(/^document-range:/);
    expect(resourceReferenceKey(moved)).not.toBe(resourceReferenceKey(target));
  });
});

describe('sanctioned MDX validation', () => {
  it('derives editor property metadata and validation from the sanctioned registry', () => {
    const Editor = () => null;
    const descriptors = createSanctionedMdxDescriptors(Editor) as Array<{
      name: string;
      kind: 'flow' | 'text';
      hasChildren: boolean;
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
    const blockAnchor = descriptors.find(({ name }) => name === 'BlockAnchor')!;
    const resourceReference = descriptors.find(
      ({ name }) => name === 'ResourceReference'
    )!;

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
    expect(blockAnchor).toMatchObject({
      kind: 'text',
      hasChildren: false,
      props: [{ name: 'id', type: 'string', required: true }],
    });
    expect(resourceReference).toMatchObject({
      kind: 'text',
      hasChildren: false,
      props: [
        {
          name: 'kind',
          type: 'string',
          required: true,
          allowedValues: ['table-row', 'document-block', 'document-range'],
        },
        { name: 'libraryId', type: 'string', required: false },
        { name: 'assetId', type: 'string', required: false },
        { name: 'displayFieldId', type: 'string', required: false },
        { name: 'documentId', type: 'string', required: false },
        { name: 'blockId', type: 'string', required: false },
        {
          name: 'blockType',
          type: 'string',
          required: false,
          allowedValues: ['heading', 'paragraph'],
        },
        { name: 'startBlockId', type: 'string', required: false },
        { name: 'startOffset', type: 'string', required: false },
        { name: 'startBefore', type: 'string', required: false },
        { name: 'startAfter', type: 'string', required: false },
        { name: 'endBlockId', type: 'string', required: false },
        { name: 'endOffset', type: 'string', required: false },
        { name: 'endBefore', type: 'string', required: false },
        { name: 'endAfter', type: 'string', required: false },
        { name: 'fallbackLabel', type: 'string', required: true },
      ],
    });
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
    )).toEqual({ type: 'success' });
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

  it('accepts document block anchors and resource references', () => {
    expect(() => validateSanctionedMdx(
      '# <BlockAnchor id="66666666-6666-4666-8666-666666666666" />Heading\n\nSee <ResourceReference kind="table-row" libraryId="11111111-1111-4111-8111-111111111111" assetId="22222222-2222-4222-8222-222222222222" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="Ada" />.\n\nSee <ResourceReference kind="document-block" documentId="44444444-4444-4444-8444-444444444444" blockId="55555555-5555-4555-8555-555555555555" blockType="paragraph" fallbackLabel="The city closes its gates" />.\n\nSee <ResourceReference kind="document-range" documentId="44444444-4444-4444-8444-444444444444" startBlockId="55555555-5555-4555-8555-555555555555" startOffset="0" startBefore="" startAfter="The city closes" endBlockId="77777777-7777-4777-8777-777777777777" endOffset="9" endBefore="at dawn. " endAfter="Guards wait." fallbackLabel="The city closes its gates at dawn." />.'
    )).not.toThrow();
  });

  it('accepts a standalone block anchor serialized as a flow element', () => {
    expect(() => validateSanctionedMdx(
      '<BlockAnchor id="66666666-6666-4666-8666-666666666666" />\n\nAnchored paragraph.'
    )).not.toThrow();
  });

  it('accepts a standalone resource reference serialized as a flow element', () => {
    expect(() => validateSanctionedMdx(
      '<ResourceReference kind="document-block" documentId="44444444-4444-4444-8444-444444444444" blockId="55555555-5555-4555-8555-555555555555" blockType="paragraph" fallbackLabel="The city closes its gates" />'
    )).not.toThrow();
  });

  it('accepts GddScriptBranchSnapshot flow cards with encoded branch trees', () => {
    expect(() => validateSanctionedMdx(
      '<GddScriptBranchSnapshot dialogueJobId="job-1" chapterKey="opening" title="Opening dialogue" projectId="project-1" dialogueDocumentId="doc-1" scriptLibraryId="lib-1" tree="[{&quot;d&quot;:0,&quot;t&quot;:&quot;Root&quot;},{&quot;d&quot;:1,&quot;t&quot;:&quot;Choice A&quot;}]" />'
    )).not.toThrow();
  });

  it('rejects GddScriptBranchSnapshot cards with invalid tree payloads', () => {
    expect(() => validateSanctionedMdx(
      '<GddScriptBranchSnapshot dialogueJobId="job-1" chapterKey="opening" title="Opening dialogue" projectId="project-1" dialogueDocumentId="doc-1" scriptLibraryId="lib-1" tree="[]" />'
    )).toThrow(DocumentContentValidationError);
  });

  it.each([
    '# <BlockAnchor id="not-a-uuid" />Heading',
    'See <ResourceReference kind="table-row" libraryId="not-a-uuid" assetId="22222222-2222-4222-8222-222222222222" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="Ada" />.',
    'See <ResourceReference kind="table-row" libraryId="11111111-1111-4111-8111-111111111111" assetId="22222222-2222-4222-8222-222222222222" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel={label} />.',
    'See <ResourceReference kind="table-row" libraryId="11111111-1111-4111-8111-111111111111" assetId="22222222-2222-4222-8222-222222222222" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="Ada" onClick="run" />.',
    'See <ResourceReference kind="table-row" libraryId="11111111-1111-4111-8111-111111111111" assetId="22222222-2222-4222-8222-222222222222" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="Ada">child</ResourceReference>.',
    'See <ResourceReference kind="table-row" documentId="44444444-4444-4444-8444-444444444444" blockId="55555555-5555-4555-8555-555555555555" blockType="paragraph" fallbackLabel="The city closes its gates" />.',
    'See <ResourceReference kind="document-block" libraryId="11111111-1111-4111-8111-111111111111" assetId="22222222-2222-4222-8222-222222222222" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="Ada" />.',
    'See <ResourceReference kind="document-block" documentId="44444444-4444-4444-8444-444444444444" blockId="55555555-5555-4555-8555-555555555555" blockType="paragraph" fallbackLabel="   " />.',
    'See <ResourceReference kind="document-range" documentId="44444444-4444-4444-8444-444444444444" startBlockId="55555555-5555-4555-8555-555555555555" startOffset="-1" startBefore="The " startAfter="city" endBlockId="77777777-7777-4777-8777-777777777777" endOffset="9" endBefore="dawn" endAfter="Guards" fallbackLabel="city closes" />.',
    `See <ResourceReference kind="document-range" documentId="44444444-4444-4444-8444-444444444444" startBlockId="55555555-5555-4555-8555-555555555555" startOffset="4" startBefore="${'x'.repeat(33)}" startAfter="city" endBlockId="77777777-7777-4777-8777-777777777777" endOffset="9" endBefore="dawn" endAfter="Guards" fallbackLabel="city closes" />.`,
    'See <ResourceReference kind="document-range" documentId="44444444-4444-4444-8444-444444444444" startBlockId="55555555-5555-4555-8555-555555555555" startOffset="4" startBefore="The " startAfter="city" endBlockId="77777777-7777-4777-8777-777777777777" endOffset="9" endBefore="dawn" fallbackLabel="city closes" />.',
  ])('rejects invalid document resource metadata: %s', (content) => {
    expect(() => validateSanctionedMdx(content)).toThrow(
      DocumentContentValidationError
    );
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
    '<Callout type="info">Inline block component</Callout>',
    'Text before <Details summary="More">inline</Details> text after.',
    '<u>\n\nBlock underline.\n\n</u>',
    '<u>before\n\n<Callout type="note">nested block</Callout>\n\nafter</u>',
    '<u />',
  ])('rejects unsafe or unsupported content: %s', (content) => {
    expect(() => validateSanctionedMdx(content)).toThrow(DocumentContentValidationError);
  });

  it('strips HTML comments outside fenced code before validation', () => {
    expect(coerceSanctionedMdxHtmlComments(
      '# Title\n\n<!-- KECO_GDD_DIALOGUE_SNAPSHOT dialogueJobId="job" -->\nOld\n<!-- /KECO_GDD_DIALOGUE_SNAPSHOT -->\n\nBody.',
    )).toBe('# Title\n\nOld\n\nBody.');
    expect(() => validateSanctionedMdx(
      '# Guide\n\n<!-- raw HTML -->\n\nKeep this.',
    )).not.toThrow();
    expect(coerceSanctionedMdxHtmlComments(
      'Before\n\n```md\n<!-- keep in code -->\n```\n\n<!-- strip me -->\nAfter',
    )).toContain('<!-- keep in code -->');
    expect(coerceSanctionedMdxHtmlComments(
      'Before\n\n```md\n<!-- keep in code -->\n```\n\n<!-- strip me -->\nAfter',
    )).not.toContain('<!-- strip me -->');
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
    '[legacy site](http://example.com/path)',
    '[secure](https://example.com/path)',
    '![secure image](https://example.com/image.png)',
    '![local image](http://127.0.0.1:54321/storage/v1/object/public/library-media-files/image.png)',
    '![localhost image](http://localhost:54321/storage/v1/object/public/library-media-files/image.png)',
    '[secure reference][docs]\n\n[docs]: HTTPS://example.com/path',
    '[project reference][project]\n\n[project]: /projects/123',
    '![secure reference image][asset]\n\n[asset]: https://example.com/image.png',
    '`<Unknown />`',
    '```tsx\n<Unknown expression={value} />\n```',
    '<img src="https://example.com/image.png" alt="secure image" />',
    '<img src="https://example.com/image.png" alt="resized" width="240" height="120" />',
  ])('accepts safe Markdown content: %s', (content) => {
    expect(() => validateSanctionedMdx(content)).not.toThrow();
  });

  it('coerces JSX img tags into Markdown images', () => {
    const coerced = coerceSanctionedMdxImages(
      '<img src="https://example.com/image.png" alt="Hero" width="100" height="50" />'
    );
    expect(coerced).toContain('![Hero](https://example.com/image.png)');
    expect(coerced).not.toMatch(/<img\b/i);
  });

  it('rejects unsafe JSX img sources after coercion', () => {
    expect(() =>
      validateSanctionedMdx('<img src="javascript:alert(1)" alt="bad" />')
    ).toThrow(DocumentContentValidationError);
  });
});
