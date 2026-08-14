import { describe, expect, it } from '@jest/globals';
import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  buildScriptDialogueBlocks,
  listScriptDialogueCharacters,
  sourceTextForDialogueBlock,
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
      row('1', { type: '2', name: 'Empress', content: 'a' }),
      row('2', { type: '3', name: 'Empress', content: 'act' }),
      row('3', { type: '1', name: 'I', content: 'hi' }),
      row('4', { type: '4', name: 'Speaker', content: 'scene' }),
    ], columns);

    expect(characters.map((item) => item.name)).toEqual(['Empress', 'I']);
    expect(characters.find((item) => item.name === 'I')?.speechType).toBe('1');
    expect(characters.find((item) => item.name === 'Empress')?.speechType).toBe('2');
  });

  it('merges empty action + following speech into one editable block', () => {
    const blocks = buildScriptDialogueBlocks([
      row('a', { type: '3', name: 'Hero', content: '' }),
      row('s', { type: '2', name: 'Hero', content: '' }),
      row('x', { type: '2', name: 'Sage', content: 'hello' }),
    ], columns);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      id: 's',
      actionRowId: 'a',
      speechRowId: 's',
      speaker: 'Hero',
      action: '',
      dialogue: '',
    });
    expect(blocks[1]).toMatchObject({
      id: 'x',
      speechRowId: 'x',
      speaker: 'Sage',
      dialogue: 'hello',
    });
  });

  it('merges named action with following same-speaker speech', () => {
    const blocks = buildScriptDialogueBlocks([
      row('a', { type: '3', name: 'Baron', content: 'nods' }),
      row('s', { type: '2', name: 'Baron', content: 'As you command' }),
    ], columns);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 's',
        actionRowId: 'a',
        speechRowId: 's',
        action: 'nods',
        dialogue: 'As you command',
        alignment: 'left',
      }),
    ]);
  });

  it('treats environment narration as an editable gray dialogue block', () => {
    const blocks = buildScriptDialogueBlocks([
      row('env', { type: '3', name: 'Speaker', content: 'The store lights are still on.' }),
      row('empty-env', { type: '3', name: '', content: 'Rain is still falling.' }),
      row('narrator', { type: '3', name: 'Narrator', content: 'Night deepens.' }),
      row('aside', { type: '3', name: 'environment', content: 'Nobody speaks.' }),
      row('speech', { type: '2', name: 'Hero', content: 'Forward.' }),
    ], columns);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'env',
        speechRowId: 'env',
        speaker: 'Narrator',
        action: '',
        dialogue: 'The store lights are still on.',
        accent: 'gray',
        alignment: 'left',
        speechType: '3',
      }),
      expect.objectContaining({
        id: 'empty-env',
        speechRowId: 'empty-env',
        speaker: 'Narrator',
        dialogue: 'Rain is still falling.',
        accent: 'gray',
        speechType: '3',
      }),
      expect.objectContaining({
        id: 'narrator',
        speechRowId: 'narrator',
        speaker: 'Narrator',
        dialogue: 'Night deepens.',
        accent: 'gray',
        speechType: '3',
      }),
      expect.objectContaining({
        id: 'aside',
        speechRowId: 'aside',
        speaker: 'environment',
        dialogue: 'Nobody speaks.',
        accent: 'gray',
        speechType: '3',
      }),
      expect.objectContaining({
        id: 'speech',
        speaker: 'Hero',
        dialogue: 'Forward.',
      }),
    ]);
  });

  it('uses raw narration text as a source-document insertion neighbor', () => {
    const [environment] = buildScriptDialogueBlocks([
      row('env', { type: '3', name: '', content: 'Rain is still falling.' }),
    ], columns);

    expect(sourceTextForDialogueBlock(environment, 'last')).toBe('Rain is still falling.');
  });
});
