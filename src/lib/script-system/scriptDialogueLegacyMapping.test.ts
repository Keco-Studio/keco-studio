import { matchLegacyDialogueRows } from './scriptDialogueLegacyMapping';

const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';
const row = (id: string, role: 'action' | 'speech', text: string) => ({ id, role, speaker: role === 'speech' ? 'Ada' : '', text });

describe('legacy dialogue mapping', () => {
  it('matches unique action and speech rows in document order', () => {
    const result = matchLegacyDialogueRows({
      blocks: [
        { blockId: A, text: 'Ada enters.', nodeIndex: 0 },
        { blockId: B, text: 'Ada：Hello', nodeIndex: 1 },
      ],
      rows: [row('action-row', 'action', 'Ada enters.'), row('speech-row', 'speech', 'Hello')],
      existing: [],
    });

    expect(result.unmatchedRowIds).toEqual([]);
    expect(result.matched).toEqual([
      expect.objectContaining({ assetId: 'action-row', blockId: A, role: 'action' }),
      expect.objectContaining({ assetId: 'speech-row', blockId: B, role: 'speech' }),
    ]);
  });

  it('uses existing neighbors to disambiguate repeated source text', () => {
    const result = matchLegacyDialogueRows({
      blocks: [
        { blockId: A, text: 'Ada：Hello', nodeIndex: 0 },
        { blockId: B, text: 'Narration', nodeIndex: 1 },
        { blockId: C, text: 'Ada：Hello', nodeIndex: 2 },
      ],
      rows: [row('speech-row', 'speech', 'Hello')],
      existing: [{ assetId: 'previous', blockId: A, documentId: 'doc', role: 'speech', syncedText: 'Ada：Hello' }],
    });

    expect(result.matched).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: 'previous', blockId: A }),
      expect.objectContaining({ assetId: 'speech-row', blockId: C }),
    ]));
  });

  it('leaves an ambiguous repeated row unmapped', () => {
    const result = matchLegacyDialogueRows({
      blocks: [
        { blockId: A, text: 'Ada：Hello', nodeIndex: 0 },
        { blockId: B, text: 'Ada：Hello', nodeIndex: 1 },
      ],
      rows: [row('speech-row', 'speech', 'Hello')],
      existing: [],
    });

    expect(result.matched).toEqual([]);
    expect(result.unmatchedRowIds).toEqual(['speech-row']);
  });
});
