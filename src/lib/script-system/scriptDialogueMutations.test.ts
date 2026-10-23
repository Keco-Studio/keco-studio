import { describe, expect, it } from '@jest/globals';
import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  applyDialogueSpeakerUpdates,
  planDialogueSpeakerSideUpdates,
  reorderDialogueRowIds,
} from './scriptDialogueMutations';

function row(id: string, type: string, speaker: string): AssetRow {
  return {
    id,
    libraryId: 'current-script',
    name: speaker,
    propertyValues: { type, name: speaker, content: id },
  };
}

describe('planDialogueSpeakerSideUpdates', () => {
  it('changes every speech row for one speaker without changing action or other rows', () => {
    const updates = planDialogueSpeakerSideUpdates({
      rows: [
        row('hero-speech-a', '2', 'Hero'),
        row('hero-action', '3', 'Hero'),
        row('hero-speech-b', '2', 'Hero'),
        row('rival-speech', '2', 'Rival'),
        row('scene-title', '4', 'Hero'),
      ],
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
      speaker: 'Hero',
      side: 'right',
    });

    expect(updates.map((update) => ({
      rowId: update.rowId,
      type: update.newPropertyValues.type,
    }))).toEqual([
      { rowId: 'hero-speech-a', type: '1' },
      { rowId: 'hero-speech-b', type: '1' },
    ]);
  });

  it('applies the planned side to cached rows used by every plot-node preview', () => {
    const rows = [
      row('hero-speech-a', '2', 'Hero'),
      row('hero-action', '3', 'Hero'),
      row('hero-speech-b', '2', 'Hero'),
      row('rival-speech', '2', 'Rival'),
    ];
    const fields = { typeKey: 'type', nameKey: 'name', contentKey: 'content' };
    const updates = planDialogueSpeakerSideUpdates({
      rows,
      fields,
      speaker: 'Hero',
      side: 'right',
    });
    const nextRows = applyDialogueSpeakerUpdates(rows, updates);

    expect(nextRows.map((item) => [item.id, item.propertyValues.type])).toEqual([
      ['hero-speech-a', '1'],
      ['hero-action', '3'],
      ['hero-speech-b', '1'],
      ['rival-speech', '2'],
    ]);
  });
});

describe('reorderDialogueRowIds', () => {
  it('reorders dialogue groups without moving non-dialogue row slots', () => {
    expect(reorderDialogueRowIds({
      orderedRowIds: ['title', 'a1', 's1', 'scene', 'a2', 's2', 'choice'],
      blockOrderIds: ['s1', 's2'],
      blockRowIds: new Map([
        ['s1', ['a1', 's1']],
        ['s2', ['a2', 's2']],
      ]),
      fromIndex: 1,
      toIndex: 0,
    })).toEqual(['title', 'a2', 's2', 'scene', 'a1', 's1', 'choice']);
  });

  it('supports dialogue groups with different row counts', () => {
    expect(reorderDialogueRowIds({
      orderedRowIds: ['title', 'action-only', 'scene', 'a2', 's2', 'choice'],
      blockOrderIds: ['action-only', 's2'],
      blockRowIds: new Map([
        ['action-only', ['action-only']],
        ['s2', ['a2', 's2']],
      ]),
      fromIndex: 1,
      toIndex: 0,
    })).toEqual(['title', 'a2', 's2', 'scene', 'action-only', 'choice']);
  });

  it('returns the original order for invalid and no-op moves', () => {
    const input = {
      orderedRowIds: ['a1', 's1', 'a2', 's2'],
      blockOrderIds: ['s1', 's2'],
      blockRowIds: new Map([
        ['s1', ['a1', 's1']],
        ['s2', ['a2', 's2']],
      ]),
    };

    expect(reorderDialogueRowIds({ ...input, fromIndex: 0, toIndex: 0 }))
      .toEqual(input.orderedRowIds);
    expect(reorderDialogueRowIds({ ...input, fromIndex: -1, toIndex: 1 }))
      .toEqual(input.orderedRowIds);
    expect(reorderDialogueRowIds({ ...input, fromIndex: 0, toIndex: 2 }))
      .toEqual(input.orderedRowIds);
  });
});
