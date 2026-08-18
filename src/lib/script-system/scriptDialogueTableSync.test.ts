import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  ScriptDialogueTableTypeConflictError,
  planScriptDialogueTableDelete,
  planScriptDialogueTableBatchEdits,
  planScriptDialogueTableEdit,
  planScriptDialogueTableInsert,
} from './scriptDialogueTableSync';

const fields = {
  typeKey: 'type-field',
  nameKey: 'name-field',
  contentKey: 'content-field',
};

function row(
  id: string,
  type: string,
  name: string,
  content: string,
  rowIndex: number,
): AssetRow {
  return {
    id,
    libraryId: 'table-library',
    name,
    rowIndex,
    propertyValues: {
      [fields.typeKey]: type,
      [fields.nameKey]: name,
      [fields.contentKey]: content,
    },
  };
}

const rows = [
  row('action-1', '3', 'Ada', 'smiles', 1),
  row('speech-1', '1', 'Ada', 'Hello', 2),
  row('narration-1', '3', 'Narrator', 'Night falls.', 3),
];

describe('Table-origin Script dialogue synchronization', () => {
  it('plans one command that updates action, speaker, and dialogue together', () => {
    expect(planScriptDialogueTableEdit({
      rows,
      fields,
      assetId: 'speech-1',
      assetName: 'Bea',
      propertyValues: {
        ...rows[1].propertyValues,
        [fields.nameKey]: 'Bea',
        [fields.contentKey]: 'Good morning',
      },
    })).toEqual({
      command: {
        type: 'edit',
        role: 'action',
        blockId: 'speech-1',
        previousText: 'smiles',
        previousDialogue: 'Hello',
        previousSpeaker: 'Ada',
        nextText: 'smiles',
        speaker: 'Bea',
        dialogue: 'Good morning',
      },
    });
  });

  it('plans a narration edit from a Type 3 environment row', () => {
    expect(planScriptDialogueTableEdit({
      rows,
      fields,
      assetId: 'narration-1',
      assetName: 'Narrator',
      propertyValues: {
        ...rows[2].propertyValues,
        [fields.contentKey]: 'Dawn breaks.',
      },
    })).toEqual({
      command: {
        type: 'edit',
        role: 'narration',
        blockId: 'narration-1',
        previousText: 'Night falls.',
        nextText: 'Dawn breaks.',
      },
    });
  });

  it('combines action and speech batch edits into one block command', () => {
    expect(planScriptDialogueTableBatchEdits({
      rows,
      fields,
      updates: [{
        assetId: 'action-1',
        assetName: 'Ada',
        propertyValues: {
          ...rows[0].propertyValues,
          [fields.contentKey]: 'waves',
        },
      }, {
        assetId: 'speech-1',
        assetName: 'Ada',
        propertyValues: {
          ...rows[1].propertyValues,
          [fields.contentKey]: 'See you.',
        },
      }],
    })).toEqual([{
      command: {
        type: 'edit',
        role: 'action',
        blockId: 'speech-1',
        previousText: 'smiles',
        previousDialogue: 'Hello',
        previousSpeaker: 'Ada',
        nextText: 'waves',
        speaker: 'Ada',
        dialogue: 'See you.',
      },
    }]);
  });

  it('rejects Type edits that would change dialogue pairing', () => {
    expect(() => planScriptDialogueTableEdit({
      rows,
      fields,
      assetId: 'speech-1',
      assetName: 'Ada',
      propertyValues: {
        ...rows[1].propertyValues,
        [fields.typeKey]: '3',
      },
    })).toThrow(ScriptDialogueTableTypeConflictError);
  });

  it('deletes the complete dialogue block when either paired row is deleted', () => {
    expect(planScriptDialogueTableDelete({
      rows,
      fields,
      assetId: 'action-1',
    })).toEqual({
      command: {
        type: 'delete',
        blockId: 'speech-1',
        previousTexts: ['smiles', 'Ada：Hello'],
      },
      assetIds: ['action-1', 'speech-1'],
    });
  });

  it('inserts a complete block at the requested Table position', () => {
    expect(planScriptDialogueTableInsert({
      rows,
      fields,
      draftId: 'new-row',
      assetName: 'Bea',
      propertyValues: {
        [fields.typeKey]: '2',
        [fields.nameKey]: 'Bea',
        [fields.contentKey]: 'Wait for me.',
      },
      rowIndex: 3,
    })).toEqual({
      command: {
        type: 'insert',
        blockId: 'new-row',
        text: 'Bea：Wait for me.',
        afterText: 'Ada：Hello',
        beforeText: 'Night falls.',
      },
    });
  });
});
