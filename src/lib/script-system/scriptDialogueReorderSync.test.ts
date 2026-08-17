import type { AssetRow } from '@/lib/types/libraryAssets';
import type { ScriptDialogueBlock } from './scriptDialogueBlocks';
import {
  applySynchronizedDialogueOrder,
  planSynchronizedDialogueReorder,
} from './scriptDialogueReorderSync';

function block(
  id: string,
  speaker: string,
  dialogue: string,
  actionRowId: string,
  speechRowId: string,
): ScriptDialogueBlock {
  return {
    id,
    actionRowId,
    speechRowId,
    rowIndexes: [],
    speaker,
    action: '',
    dialogue,
    speechType: '2',
    accent: 'blue',
    alignment: 'left',
  };
}

function row(id: string, rowIndex: number): AssetRow {
  return { id, libraryId: 'library', name: id, propertyValues: {}, rowIndex };
}

const blocks = [
  block('speech-a', 'Ada', 'Hello', 'action-a', 'speech-a'),
  block('speech-b', 'Ben', 'Wait', 'action-b', 'speech-b'),
];
const rows = [
  row('action-a', 1),
  row('speech-a', 2),
  row('action-b', 3),
  row('speech-b', 4),
];

describe('Script dialogue reorder synchronization', () => {
  it('plans a move before the target for an upward drag', () => {
    expect(planSynchronizedDialogueReorder({ blocks, rows, fromIndex: 1, toIndex: 0 }))
      .toEqual({
        command: {
          type: 'reorder',
          movingTexts: ['Ben：Wait'],
          targetText: 'Ada：Hello',
          edge: 'before',
        },
        previousOrderIds: ['action-a', 'speech-a', 'action-b', 'speech-b'],
        nextOrderIds: ['action-b', 'speech-b', 'action-a', 'speech-a'],
      });
  });

  it('applies the committed order to row indexes', () => {
    expect(applySynchronizedDialogueOrder(rows, [
      'action-b', 'speech-b', 'action-a', 'speech-a',
    ]).map((item) => [item.id, item.rowIndex])).toEqual([
      ['action-b', 1],
      ['speech-b', 2],
      ['action-a', 3],
      ['speech-a', 4],
    ]);
  });
});
