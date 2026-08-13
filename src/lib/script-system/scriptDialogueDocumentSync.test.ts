import { applyScriptDialogueCommand } from './scriptDialogueDocumentSync';

const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';
const source = [
  `<BlockAnchor id="${A}" />Ada：Hello`,
  `<BlockAnchor id="${B}" />Rain falls.`,
  `<BlockAnchor id="${C}" />Ben：Wait`,
].join('\n\n');

describe('script dialogue document sync', () => {
  it('edits one source block by its previous visible text', () => {
    const result = applyScriptDialogueCommand(source, {
      type: 'edit',
      previousText: 'Ada：Hello',
      nextText: 'Ada：Good morning',
    });
    expect(result.markdown).toContain('Ada：Good morning');
    expect(result.changedBlockIds).toEqual([A]);
  });

  it('deletes only the matching source block', () => {
    const result = applyScriptDialogueCommand(source, {
      type: 'delete',
      previousTexts: ['Rain falls.'],
    });
    expect(result.markdown).not.toContain('Rain falls.');
    expect(result.markdown).toContain('Ada：Hello');
    expect(result.changedBlockIds).toEqual([B]);
  });

  it('edits dialogue while preserving the source speaker cue', () => {
    const document = source.replace('Ada：Hello', 'Ada（smiles）：Hello');
    const result = applyScriptDialogueCommand(document, {
      type: 'edit',
      role: 'speech',
      previousText: 'Ada：Hello',
      nextText: 'Ada：Good morning',
    });
    expect(result.markdown).toContain('Ada（smiles）：Good morning');
    expect(result.changedBlockIds).toEqual([A]);
  });

  it('edits an action stored in the source speaker cue', () => {
    const document = source.replace('Ada：Hello', 'Ada（smiles）：Hello');
    const result = applyScriptDialogueCommand(document, {
      type: 'edit',
      role: 'action',
      previousText: 'smiles',
      nextText: 'waves',
      speaker: 'Ada',
      dialogue: 'Hello',
    });
    expect(result.markdown).toContain('Ada（waves）：Hello');
  });

  it('normalizes a cue written after the colon to speaker-cue-colon-dialogue', () => {
    const document = source.replace('Ada：Hello', 'Ada：（smiles）Hello');
    const result = applyScriptDialogueCommand(document, {
      type: 'edit',
      role: 'action',
      previousText: 'smiles',
      nextText: 'waves',
      speaker: 'Ada',
      dialogue: 'Hello',
    });

    expect(result.markdown).toContain('Ada（waves）：Hello');
    expect(result.markdown).not.toContain('Ada：（');
  });

  it('merges an adjacent legacy action and speech into one speaker line', () => {
    const result = applyScriptDialogueCommand(source, {
      type: 'edit',
      role: 'action',
      previousText: 'Rain falls.',
      nextText: 'looks outside',
      speaker: 'Ben',
      dialogue: 'Wait',
    });

    expect(result.markdown).toContain('Ben（looks outside）：Wait');
    expect(result.markdown).not.toContain('Rain falls.');
    expect(result.changedBlockIds).toEqual([B, C]);
  });

  it('deletes a combined action and speech source paragraph once', () => {
    const document = source.replace('Ada：Hello', 'Ada（smiles）：Hello');
    const result = applyScriptDialogueCommand(document, {
      type: 'delete',
      previousTexts: ['smiles', 'Ada：Hello'],
    });
    expect(result.markdown).not.toContain('Ada');
    expect(result.changedBlockIds).toEqual([A]);
  });

  it('clears speech while retaining a combined action as its own paragraph', () => {
    const document = source.replace('Ada：Hello', 'Ada（smiles）：Hello');
    const result = applyScriptDialogueCommand(document, {
      type: 'edit',
      role: 'speech',
      previousText: 'Ada：Hello',
      nextText: 'Ada：',
    });
    expect(result.markdown).toContain('smiles');
    expect(result.markdown).not.toContain('Hello');
  });

  it('refuses to append an inserted dialogue when its supplied neighbor cannot be mapped', () => {
    const inserted = '66666666-6666-4666-8666-666666666666';
    expect(() => applyScriptDialogueCommand(source, {
        type: 'insert',
        blockId: inserted,
        text: 'Ada：New line',
        afterText: 'Generated table text that is absent from the document',
      })).toThrow('SOURCE_MAPPING_AMBIGUOUS');
  });

  it('uses both surrounding lines to place an insertion among repeated text', () => {
    const inserted = '66666666-6666-4666-8666-666666666666';
    const repeated = [
      `<BlockAnchor id="${A}" />Ada：Hello`,
      `<BlockAnchor id="${B}" />Rain falls.`,
      `<BlockAnchor id="${C}" />Ada：Hello`,
    ].join('\n\n');
    const result = applyScriptDialogueCommand(repeated, {
      type: 'insert',
      blockId: inserted,
      text: 'Ben：New line',
      afterText: 'Rain falls.',
      beforeText: 'Ada：Hello',
    });

    expect(result.markdown.indexOf(inserted)).toBeLessThan(result.markdown.indexOf(C));
  });

  it('uses the table position when generated neighbor text is absent from the source', () => {
    const inserted = '66666666-6666-4666-8666-666666666666';
    const result = applyScriptDialogueCommand(source, {
      type: 'insert',
      blockId: inserted,
      text: 'Ben（looks outside）：',
      afterText: 'Generated previous row',
      beforeText: 'Generated next row',
      position: 2,
    });

    expect(result.markdown.indexOf(inserted)).toBeLessThan(result.markdown.indexOf(C));
    expect(result.markdown).toContain('Ben（looks outside）：');
  });

  it('fills speech into an action-only speaker line', () => {
    const actionOnly = source.replace('Ada：Hello', 'Ada（smiles）：');
    const result = applyScriptDialogueCommand(actionOnly, {
      type: 'edit',
      role: 'action',
      previousText: 'smiles',
      nextText: 'smiles',
      speaker: 'Ada',
      dialogue: 'Hello',
    });

    expect(result.markdown).toContain('Ada（smiles）：Hello');
  });

  it('merges repeated inserts for the same table row anchor', () => {
    const rowId = '66666666-6666-4666-8666-666666666666';
    const withSpeech = applyScriptDialogueCommand(source, {
      type: 'insert',
      blockId: rowId,
      text: 'Ada：New line',
    });
    const withAction = applyScriptDialogueCommand(withSpeech.markdown, {
      type: 'insert',
      blockId: rowId,
      text: 'Ada（smiles）：',
    });

    expect(withAction.markdown).toContain('Ada（smiles）：New line');
    expect(withAction.markdown.match(new RegExp(rowId, 'g'))).toHaveLength(1);
  });

  it('deletes a unique adjacent action and speech pair even when each text repeats', () => {
    const firstAction = '66666666-6666-4666-8666-666666666666';
    const firstSpeech = '77777777-7777-4777-8777-777777777777';
    const secondAction = '88888888-8888-4888-8888-888888888888';
    const secondSpeech = '99999999-9999-4999-8999-999999999999';
    const document = [
      `<BlockAnchor id="${firstAction}" />2`,
      `<BlockAnchor id="${firstSpeech}" />Other：line`,
      `<BlockAnchor id="${secondAction}" />2`,
      `<BlockAnchor id="${secondSpeech}" />Ada：2`,
      `<BlockAnchor id="${A}" />Ada：2`,
    ].join('\n\n');

    const result = applyScriptDialogueCommand(document, {
      type: 'delete',
      previousTexts: ['2', 'Ada：2'],
    });

    expect(result.changedBlockIds).toEqual([secondAction, secondSpeech]);
    expect(result.markdown).toContain(firstAction);
    expect(result.markdown).toContain(A);
    expect(result.markdown).not.toContain(secondAction);
    expect(result.markdown).not.toContain(secondSpeech);
  });
});
