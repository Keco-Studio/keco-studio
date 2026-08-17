import { deriveScriptDocumentReconciliation } from './scriptDocumentReconciliation';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function document(...lines: Array<[string, string]>): string {
  return lines.map(([id, text]) => `<BlockAnchor id="${id}" />${text}`).join('\n\n');
}

describe('deriveScriptDocumentReconciliation', () => {
  it('derives a dialogue edit from one anchored source change', () => {
    expect(deriveScriptDocumentReconciliation(
      document([A, 'Ada（smiles）：Hello']),
      document([A, 'Ada（waves）：Good morning']),
    )).toEqual({
      type: 'command',
      command: {
        type: 'edit',
        role: 'action',
        blockId: A,
        previousText: 'smiles',
        previousDialogue: 'Hello',
        nextText: 'waves',
        speaker: 'Ada',
        dialogue: 'Good morning',
      },
    });
  });

  it('derives a narration edit without inventing a speaker', () => {
    expect(deriveScriptDocumentReconciliation(
      document([A, 'Rain falls.']),
      document([A, 'Rain stops.']),
    )).toEqual({
      type: 'command',
      command: {
        type: 'edit',
        role: 'narration',
        blockId: A,
        previousText: 'Rain falls.',
        nextText: 'Rain stops.',
      },
    });
  });

  it('derives one unambiguous anchored reorder', () => {
    expect(deriveScriptDocumentReconciliation(
      document([A, 'Ada：Hello'], [B, 'Rain falls.'], [C, 'Ben：Wait']),
      document([C, 'Ben：Wait'], [A, 'Ada：Hello'], [B, 'Rain falls.']),
    )).toEqual({
      type: 'command',
      command: {
        type: 'reorder',
        movingTexts: ['Ben：Wait'],
        targetText: 'Ada：Hello',
        edge: 'before',
      },
    });
  });

  it('derives one anchored dialogue insertion between existing blocks', () => {
    expect(deriveScriptDocumentReconciliation(
      document([A, 'Ada：Hello'], [C, 'Ben：Wait']),
      document([A, 'Ada：Hello'], [B, 'Cara：Go'], [C, 'Ben：Wait']),
    )).toEqual({
      type: 'command',
      command: {
        type: 'insert',
        text: 'Cara：Go',
        blockId: B,
        afterText: 'Ada：Hello',
      },
    });
  });

  it('derives one anchored block deletion', () => {
    expect(deriveScriptDocumentReconciliation(
      document([A, 'Ada：Hello'], [B, 'Cara：Go'], [C, 'Ben：Wait']),
      document([A, 'Ada：Hello'], [C, 'Ben：Wait']),
    )).toEqual({
      type: 'command',
      command: {
        type: 'delete',
        blockId: B,
        previousTexts: ['Cara：Go'],
      },
    });
  });

  it('rejects multiple anchored insertions as ambiguous', () => {
    expect(deriveScriptDocumentReconciliation(
      document([A, 'Ada：Hello']),
      document([A, 'Ada：Hello'], [B, 'Cara：Go'], [C, 'Ben：Wait']),
    )).toEqual({ type: 'ambiguous' });
  });

  it('rejects multiple content edits as ambiguous', () => {
    expect(deriveScriptDocumentReconciliation(
      document([A, 'Ada：Hello'], [B, 'Ben：Wait']),
      document([A, 'Ada：Changed'], [B, 'Ben：Changed']),
    )).toEqual({ type: 'ambiguous' });
  });

  it('returns a no-op for formatting that preserves anchored visible text', () => {
    const markdown = document([A, 'Ada：Hello']);
    expect(deriveScriptDocumentReconciliation(markdown, markdown)).toEqual({ type: 'none' });
  });
});
