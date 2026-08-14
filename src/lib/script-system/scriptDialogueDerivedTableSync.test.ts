import { describe, expect, it } from '@jest/globals';
import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  buildDerivedDialogueTableOperation,
  planDerivedDialogueCommand,
} from './scriptDialogueDerivedTableSync';

const fields = { typeKey: 'type', nameKey: 'name', contentKey: 'content' };

function row(
  id: string,
  type: string,
  name: string,
  content: string,
  rowIndex: number,
): AssetRow {
  return {
    id,
    libraryId: 'table',
    name,
    rowIndex,
    propertyValues: { type, name, content },
  };
}

const rows = [
  row('previous', '2', 'Lin', 'previous line', 1),
  row('action', '3', 'Lu', 'whispers', 2),
  row('speech', '2', 'Lu', 'original line', 3),
  row('next', '2', 'Lin', 'next line', 4),
];

describe('planDerivedDialogueCommand', () => {
  it('matches an edit using the complete old dialogue block', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'edit',
      role: 'action',
      previousText: 'whispers',
      previousDialogue: 'original line',
      nextText: 'smiles',
      speaker: 'Lu',
      dialogue: 'new line',
    });

    expect(plan).toMatchObject({
      type: 'edit',
      block: { actionRowId: 'action', speechRowId: 'speech' },
      values: { speaker: 'Lu', action: 'smiles', dialogue: 'new line' },
    });
  });

  it('places an inserted block after the uniquely matching previous dialogue', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'insert',
      blockId: 'source-block',
      text: 'Lin（nods）：added line',
      afterText: 'Lu：original line',
      beforeText: 'Lin：next line',
    });

    expect(plan).toEqual({
      type: 'insert',
      afterRowId: 'speech',
      values: { speaker: 'Lin', action: 'nods', dialogue: 'added line' },
    });
  });

  it('marks an insertion before the first block as a table-start insertion', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'insert',
      blockId: 'source-block',
      text: 'Lin：opening line',
      beforeText: 'Lin：previous line',
    });

    expect(plan).toEqual({
      type: 'insert',
      afterRowId: null,
      insertAtStart: true,
      values: { speaker: 'Lin', action: '', dialogue: 'opening line' },
    });
  });

  it('deletes only a block matching both its action and speech text', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'delete',
      previousTexts: ['whispers', 'Lu：original line'],
    });

    expect(plan).toMatchObject({
      type: 'delete',
      block: { actionRowId: 'action', speechRowId: 'speech' },
    });
  });

  it('builds a complete atomic mutation payload for a matched table', () => {
    const operation = buildDerivedDialogueTableOperation(
      'table-id',
      rows,
      fields,
      {
        type: 'edit',
        role: 'action',
        previousText: 'whispers',
        previousDialogue: 'original line',
        nextText: 'smiles',
        speaker: 'Lu',
        dialogue: 'new line',
      },
    );

    expect(operation).toEqual({
      type: 'edit',
      libraryId: 'table-id',
      typeFieldId: 'type',
      nameFieldId: 'name',
      contentFieldId: 'content',
      actionRowId: 'action',
      speechRowId: 'speech',
      speaker: 'Lu',
      action: 'smiles',
      dialogue: 'new line',
      speechType: '2',
    });
  });
});
