import {
  deleteScriptSourceBlocks,
  appendScriptSourceBlock,
  insertScriptSourceBlock,
  listScriptSourceBlocks,
  moveScriptSourceBlocks,
  replaceScriptSourceBlock,
} from './scriptDocumentBlocks';

const HEADING = '11111111-1111-4111-8111-111111111111';
const ACTION = '22222222-2222-4222-8222-222222222222';
const SPEECH = '33333333-3333-4333-8333-333333333333';
const NARRATION = '44444444-4444-4444-8444-444444444444';
const SECOND_SPEECH = '55555555-5555-4555-8555-555555555555';
const INSERTED = '66666666-6666-4666-8666-666666666666';

function anchor(id: string): string {
  return `<BlockAnchor id="${id}" />`;
}

const markdown = [
  `# ${anchor(HEADING)} Scene`,
  `${anchor(ACTION)} Ada enters.`,
  `${anchor(SPEECH)} Ada：Hello`,
  `${anchor(NARRATION)} Rain hits the window.`,
  `${anchor(SECOND_SPEECH)} Ben：Wait`,
].join('\n\n');

describe('script document blocks', () => {
  it('lists anchored top-level paragraphs without treating headings as dialogue blocks', () => {
    expect(listScriptSourceBlocks(markdown)).toEqual([
      { blockId: ACTION, text: 'Ada enters.', nodeIndex: 1 },
      { blockId: SPEECH, text: 'Ada：Hello', nodeIndex: 2 },
      { blockId: NARRATION, text: 'Rain hits the window.', nodeIndex: 3 },
      { blockId: SECOND_SPEECH, text: 'Ben：Wait', nodeIndex: 4 },
    ]);
  });

  it('replaces one paragraph while preserving its anchor and surrounding blocks', () => {
    const result = replaceScriptSourceBlock(markdown, SPEECH, 'Ada：Good morning');

    expect(result).toContain(`${anchor(SPEECH)}Ada：Good morning`);
    expect(result).toContain(anchor(HEADING));
    expect(listScriptSourceBlocks(result)).toContainEqual({
      blockId: NARRATION,
      text: 'Rain hits the window.',
      nodeIndex: 3,
    });
  });

  it('inserts an anchored paragraph at a mapped boundary', () => {
    const result = insertScriptSourceBlock(markdown, {
      blockId: INSERTED,
      text: 'Ada smiles.',
      anchorBlockId: SPEECH,
      edge: 'after',
    });

    expect(result.indexOf(anchor(SPEECH))).toBeLessThan(result.indexOf(anchor(INSERTED)));
    expect(result.indexOf(anchor(INSERTED))).toBeLessThan(result.indexOf(anchor(NARRATION)));
    expect(listScriptSourceBlocks(result)).toContainEqual({
      blockId: INSERTED,
      text: 'Ada smiles.',
      nodeIndex: 3,
    });
  });

  it('appends a new anchored paragraph when no legacy neighbor can be mapped', () => {
    const result = appendScriptSourceBlock(markdown, {
      blockId: INSERTED,
      text: 'Ada smiles.',
    });

    expect(result.indexOf(anchor(SECOND_SPEECH))).toBeLessThan(result.indexOf(anchor(INSERTED)));
    expect(listScriptSourceBlocks(result).at(-1)).toEqual({
      blockId: INSERTED,
      text: 'Ada smiles.',
      nodeIndex: 5,
    });
  });

  it('deletes only the requested dialogue paragraphs', () => {
    const result = deleteScriptSourceBlocks(markdown, [ACTION, SPEECH]);

    expect(result).not.toContain(anchor(ACTION));
    expect(result).not.toContain(anchor(SPEECH));
    expect(result).toContain(anchor(HEADING));
    expect(result).toContain(anchor(NARRATION));
  });

  it('moves only mapped dialogue blocks and leaves intervening narration independent', () => {
    const result = moveScriptSourceBlocks(markdown, {
      movingBlockIds: [SECOND_SPEECH],
      target: { blockId: ACTION, edge: 'before' },
    });

    expect(result.indexOf(anchor(SECOND_SPEECH))).toBeLessThan(result.indexOf(anchor(ACTION)));
    expect(result.indexOf(anchor(ACTION))).toBeLessThan(result.indexOf(anchor(NARRATION)));
    expect(listScriptSourceBlocks(result)).toContainEqual({
      blockId: NARRATION,
      text: 'Rain hits the window.',
      nodeIndex: 4,
    });
  });
});
