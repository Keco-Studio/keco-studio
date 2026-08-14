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
  row('previous', '2', '林溪', '前一句', 1),
  row('action', '3', '陆扬', '低声说', 2),
  row('speech', '2', '陆扬', '原对白', 3),
  row('next', '2', '林溪', '后一句', 4),
];

describe('planDerivedDialogueCommand', () => {
  it('matches an edit using the complete old dialogue block', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'edit',
      role: 'action',
      previousText: '低声说',
      previousDialogue: '原对白',
      nextText: '笑着说',
      speaker: '陆扬',
      dialogue: '新对白',
    });

    expect(plan).toMatchObject({
      type: 'edit',
      block: { actionRowId: 'action', speechRowId: 'speech' },
      values: { speaker: '陆扬', action: '笑着说', dialogue: '新对白' },
    });
  });

  it('places an inserted block after the uniquely matching previous dialogue', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'insert',
      blockId: 'source-block',
      text: '林溪（轻轻点头）：新增对白',
      afterText: '陆扬：原对白',
      beforeText: '林溪：后一句',
    });

    expect(plan).toEqual({
      type: 'insert',
      afterRowId: 'speech',
      values: { speaker: '林溪', action: '轻轻点头', dialogue: '新增对白' },
    });
  });

  it('marks an insertion before the first block as a table-start insertion', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'insert',
      blockId: 'source-block',
      text: '林溪：开场对白',
      beforeText: '林溪：前一句',
    });

    expect(plan).toEqual({
      type: 'insert',
      afterRowId: null,
      insertAtStart: true,
      values: { speaker: '林溪', action: '', dialogue: '开场对白' },
    });
  });

  it('deletes only a block matching both its action and speech text', () => {
    const plan = planDerivedDialogueCommand(rows, fields, {
      type: 'delete',
      previousTexts: ['低声说', '陆扬：原对白'],
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
        previousText: '低声说',
        previousDialogue: '原对白',
        nextText: '笑着说',
        speaker: '陆扬',
        dialogue: '新对白',
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
      speaker: '陆扬',
      action: '笑着说',
      dialogue: '新对白',
      speechType: '2',
    });
  });
});
