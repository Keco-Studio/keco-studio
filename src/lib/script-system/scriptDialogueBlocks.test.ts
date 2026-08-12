import { describe, expect, it } from '@jest/globals';
import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  buildScriptDialogueBlocks,
  listScriptDialogueCharacters,
} from './scriptDialogueBlocks';

const columns = {
  typeKey: 'type',
  nameKey: 'name',
  contentKey: 'content',
};

function row(
  id: string,
  propertyValues: Record<string, string>,
): AssetRow {
  return { id, libraryId: 'lib', name: id, propertyValues };
}

describe('scriptDialogueBlocks', () => {
  it('lists unique named speakers across the library', () => {
    const characters = listScriptDialogueCharacters([
      row('1', { type: '2', name: '女帝', content: 'a' }),
      row('2', { type: '3', name: '女帝', content: 'act' }),
      row('3', { type: '1', name: '我', content: 'hi' }),
      row('4', { type: '4', name: 'Speaker', content: 'scene' }),
    ], columns);

    expect(characters.map((item) => item.name)).toEqual(['女帝', '我']);
    expect(characters.find((item) => item.name === '我')?.speechType).toBe('1');
    expect(characters.find((item) => item.name === '女帝')?.speechType).toBe('2');
  });

  it('merges empty action + following speech into one editable block', () => {
    const blocks = buildScriptDialogueBlocks([
      row('a', { type: '3', name: '勇者', content: '' }),
      row('s', { type: '2', name: '勇者', content: '' }),
      row('x', { type: '2', name: '贤者', content: 'hello' }),
    ], columns);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      id: 's',
      actionRowId: 'a',
      speechRowId: 's',
      speaker: '勇者',
      action: '',
      dialogue: '',
    });
    expect(blocks[1]).toMatchObject({
      id: 'x',
      speechRowId: 'x',
      speaker: '贤者',
      dialogue: 'hello',
    });
  });

  it('merges named action with following same-speaker speech', () => {
    const blocks = buildScriptDialogueBlocks([
      row('a', { type: '3', name: '男爵', content: '点头' }),
      row('s', { type: '2', name: '男爵', content: '遵命' }),
    ], columns);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 's',
        actionRowId: 'a',
        speechRowId: 's',
        action: '点头',
        dialogue: '遵命',
        alignment: 'left',
      }),
    ]);
  });

  it('treats environment narration as an editable gray dialogue block', () => {
    const blocks = buildScriptDialogueBlocks([
      row('env', { type: '3', name: 'Speaker', content: '便利店的灯还亮着。' }),
      row('empty-env', { type: '3', name: '', content: '雨还在下。' }),
      row('narrator', { type: '3', name: 'Narrator', content: '夜色渐深。' }),
      row('aside', { type: '3', name: '旁白', content: '没有人说话。' }),
      row('speech', { type: '2', name: '勇者', content: '向前。' }),
    ], columns);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'env',
        speechRowId: 'env',
        speaker: 'Narrator',
        action: '',
        dialogue: '便利店的灯还亮着。',
        accent: 'gray',
        alignment: 'left',
        speechType: '3',
      }),
      expect.objectContaining({
        id: 'empty-env',
        speechRowId: 'empty-env',
        speaker: 'Narrator',
        dialogue: '雨还在下。',
        accent: 'gray',
        speechType: '3',
      }),
      expect.objectContaining({
        id: 'narrator',
        speechRowId: 'narrator',
        speaker: 'Narrator',
        dialogue: '夜色渐深。',
        accent: 'gray',
        speechType: '3',
      }),
      expect.objectContaining({
        id: 'aside',
        speechRowId: 'aside',
        speaker: '旁白',
        dialogue: '没有人说话。',
        accent: 'gray',
        speechType: '3',
      }),
      expect.objectContaining({
        id: 'speech',
        speaker: '勇者',
        dialogue: '向前。',
      }),
    ]);
  });
});
