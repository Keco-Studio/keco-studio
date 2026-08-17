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

  it('recovers a stale action value when speaker and dialogue still identify one block', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'edit',
      role: 'action',
      previousText: 'already changed in the document',
      previousDialogue: 'original line',
      nextText: 'smiles',
      speaker: 'Lu',
      dialogue: 'original line',
    });

    expect(plan).toMatchObject({
      type: 'edit',
      block: { actionRowId: 'action', speechRowId: 'speech' },
      values: { speaker: 'Lu', action: 'smiles', dialogue: 'original line' },
    });
  });

  it('recovers stale dialogue when speaker and action still identify one block', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'edit',
      role: 'action',
      previousText: 'whispers',
      previousDialogue: 'already changed in the conversation',
      nextText: 'whispers',
      speaker: 'Lu',
      dialogue: 'final line',
    });

    expect(plan).toMatchObject({
      type: 'edit',
      block: { actionRowId: 'action', speechRowId: 'speech' },
      values: { speaker: 'Lu', action: 'whispers', dialogue: 'final line' },
    });
  });

  it('uses the previous speaker to locate a block before renaming it', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'edit',
      role: 'action',
      previousText: 'whispers',
      previousDialogue: 'original line',
      previousSpeaker: 'Lu',
      nextText: 'whispers',
      speaker: 'Mira',
      dialogue: 'renamed line',
    });

    expect(plan).toMatchObject({
      type: 'edit',
      block: { actionRowId: 'action', speechRowId: 'speech' },
      values: { speaker: 'Mira', action: 'whispers', dialogue: 'renamed line' },
    });
  });

  it('does not recover a stale action when speaker and dialogue are ambiguous', () => {
    const duplicated = [
      ...rows,
      row('action-2', '3', 'Lu', 'looks away', 5),
      row('speech-2', '2', 'Lu', 'original line', 6),
    ];

    expect(planDerivedDialogueCommand(duplicated, fields, {
      type: 'edit',
      role: 'action',
      previousText: 'already changed in the document',
      previousDialogue: 'original line',
      nextText: 'smiles',
      speaker: 'Lu',
      dialogue: 'original line',
    })).toBeNull();
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

  it('builds a row-order mutation for a matched dialogue reorder', () => {
    const operation = buildDerivedDialogueTableOperation(
      'table-id',
      rows,
      fields,
      {
        type: 'reorder',
        movingTexts: ['Lu：original line'],
        targetText: 'Lin：previous line',
        edge: 'before',
      },
    );

    expect(operation).toEqual({
      type: 'reorder',
      libraryId: 'table-id',
      typeFieldId: 'type',
      nameFieldId: 'name',
      contentFieldId: 'content',
      expectedOrderIds: ['previous', 'action', 'speech', 'next'],
      nextOrderIds: ['action', 'speech', 'previous', 'next'],
    });
  });

  it('maps a plain document narration edit to its environment row', () => {
    const environmentRows = [row('rain', '3', 'Speaker', 'Rain falls.', 1)];
    expect(buildDerivedDialogueTableOperation(
      'table-id',
      environmentRows,
      fields,
      {
        type: 'edit',
        role: 'narration',
        previousText: 'Rain falls.',
        nextText: 'Rain stops.',
      },
    )).toMatchObject({
      type: 'edit',
      actionRowId: null,
      speechRowId: 'rain',
      dialogue: 'Rain stops.',
    });
  });
});
