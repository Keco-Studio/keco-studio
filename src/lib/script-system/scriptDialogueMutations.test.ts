import { describe, expect, it } from '@jest/globals';
import { reorderDialogueRowIds } from './scriptDialogueMutations';

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
