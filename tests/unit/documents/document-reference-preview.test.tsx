import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentReferencePreview } from '@/components/documents/DocumentReferencePreview';

jest.mock('@/components/documents/ResourceReferencePickerModal.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

const BLOCK_A = '11111111-1111-4111-8111-111111111111';
const BLOCK_B = '22222222-2222-4222-8222-222222222222';

describe('DocumentReferencePreview', () => {
  it('renders ordered heading and paragraph blocks as selectable source text', () => {
    const markup = renderToStaticMarkup(
      <DocumentReferencePreview
        blocks={[
          { blockId: BLOCK_A, blockType: 'heading', headingLevel: 2, text: 'Conflict' },
          {
            blockId: BLOCK_B,
            blockType: 'paragraph',
            text: 'The city closes its gates.',
            nearestHeading: 'Conflict',
          },
        ]}
        emptyText="Choose a document"
        onSelection={() => undefined}
      />
    );

    expect(markup).toContain('aria-label="Document text preview"');
    expect(markup).toContain(`data-reference-block-id="${BLOCK_A}"`);
    expect(markup).toContain('data-reference-block-type="heading"');
    expect(markup).toContain(`data-reference-block-id="${BLOCK_B}"`);
    expect(markup.indexOf('Conflict')).toBeLessThan(
      markup.indexOf('The city closes its gates.')
    );
  });

  it('shows the supplied empty state when no source blocks exist', () => {
    const markup = renderToStaticMarkup(
      <DocumentReferencePreview
        blocks={[]}
        emptyText="No selectable content"
        onSelection={() => undefined}
      />
    );

    expect(markup).toContain('No selectable content');
  });
});
