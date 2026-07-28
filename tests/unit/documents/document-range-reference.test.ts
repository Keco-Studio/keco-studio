import {
  createDocumentRangeTarget,
  resolveDocumentRange,
  type DocumentRangeBlock,
} from '@/lib/documents/documentRangeReference';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const BLOCK_A = '22222222-2222-4222-8222-222222222222';
const BLOCK_B = '33333333-3333-4333-8333-333333333333';
const BLOCK_C = '44444444-4444-4444-8444-444444444444';

function blocks(...texts: string[]): DocumentRangeBlock[] {
  const ids = [BLOCK_A, BLOCK_B, BLOCK_C];
  return texts.map((text, index) => ({
    blockId: ids[index],
    blockType: index === 0 ? 'heading' : 'paragraph',
    text,
    ...(index > 0 ? { nearestHeading: texts[0] } : {}),
  }));
}

describe('document text range references', () => {
  it('captures and resolves a same-block range', () => {
    const source = blocks('Heading', 'The city closes its gates tonight.');
    const target = createDocumentRangeTarget({
      documentId: DOCUMENT_ID,
      blocks: source,
      anchor: { blockId: BLOCK_B, offset: 4 },
      focus: { blockId: BLOCK_B, offset: 26 },
    });

    expect(target).toMatchObject({
      kind: 'document-range',
      documentId: DOCUMENT_ID,
      startBlockId: BLOCK_B,
      startOffset: 4,
      endBlockId: BLOCK_B,
      endOffset: 26,
      fallbackLabel: 'city closes its gates',
    });
    expect(resolveDocumentRange(target!, source)).toEqual({
      label: 'city closes its gates',
      startBlockId: BLOCK_B,
      nearestHeading: 'Heading',
    });
  });

  it('canonicalizes a backward cross-block selection and joins blocks inline', () => {
    const source = blocks(
      'Heading',
      'First paragraph begins here.',
      'Second paragraph finishes there.'
    );
    const target = createDocumentRangeTarget({
      documentId: DOCUMENT_ID,
      blocks: source,
      anchor: { blockId: BLOCK_C, offset: 16 },
      focus: { blockId: BLOCK_B, offset: 6 },
    });

    expect(target).toMatchObject({
      startBlockId: BLOCK_B,
      startOffset: 6,
      endBlockId: BLOCK_C,
      endOffset: 16,
      fallbackLabel: 'paragraph begins here. Second paragraph',
    });
    expect(resolveDocumentRange(target!, source)?.label).toBe(
      'paragraph begins here. Second paragraph'
    );
  });

  it('moves boundaries after text is inserted before the selection', () => {
    const source = blocks('Heading', 'Alpha selected text omega.');
    const target = createDocumentRangeTarget({
      documentId: DOCUMENT_ID,
      blocks: source,
      anchor: { blockId: BLOCK_B, offset: 6 },
      focus: { blockId: BLOCK_B, offset: 19 },
    })!;

    const updated = blocks('Heading', 'Prefix Alpha selected text omega.');

    expect(resolveDocumentRange(target, updated)?.label).toBe('selected text');
  });

  it('uses current text after edits inside the selected range', () => {
    const source = blocks(
      'Heading',
      'Before selected old words',
      'more selected text after'
    );
    const target = createDocumentRangeTarget({
      documentId: DOCUMENT_ID,
      blocks: source,
      anchor: { blockId: BLOCK_B, offset: 7 },
      focus: { blockId: BLOCK_C, offset: 18 },
    })!;
    const updated = blocks(
      'Heading',
      'Before selected new expanded words',
      'more revised text after'
    );

    expect(resolveDocumentRange(target, updated)?.label).toBe(
      'selected new expanded words more revised text'
    );
  });

  it('includes blocks inserted between the surviving boundaries', () => {
    const source = blocks('Heading', 'Start chosen', 'chosen end');
    const target = createDocumentRangeTarget({
      documentId: DOCUMENT_ID,
      blocks: source,
      anchor: { blockId: BLOCK_B, offset: 6 },
      focus: { blockId: BLOCK_C, offset: 6 },
    })!;
    const updated: DocumentRangeBlock[] = [
      source[0],
      source[1],
      {
        blockId: '55555555-5555-4555-8555-555555555555',
        blockType: 'paragraph',
        text: 'new middle paragraph',
      },
      source[2],
    ];

    expect(resolveDocumentRange(target, updated)?.label).toBe(
      'chosen new middle paragraph chosen'
    );
  });

  it('rejects blank selections, deleted boundaries, and ambiguous re-anchoring', () => {
    const source = blocks('Heading', 'Alpha repeated Alpha repeated omega.');
    expect(createDocumentRangeTarget({
      documentId: DOCUMENT_ID,
      blocks: source,
      anchor: { blockId: BLOCK_B, offset: 5 },
      focus: { blockId: BLOCK_B, offset: 6 },
    })).toBeNull();

    const target = createDocumentRangeTarget({
      documentId: DOCUMENT_ID,
      blocks: source,
      anchor: { blockId: BLOCK_B, offset: 6 },
      focus: { blockId: BLOCK_B, offset: 14 },
    })!;
    expect(resolveDocumentRange(target, blocks('Heading'))).toBeNull();

    const ambiguousTarget = {
      ...target,
      startOffset: 2,
      startBefore: 'x',
      startAfter: '',
      endOffset: 4,
      endBefore: '',
      endAfter: 'z',
    };
    expect(resolveDocumentRange(
      ambiguousTarget,
      blocks('Heading', 'xaxz')
    )).toBeNull();
  });
});
