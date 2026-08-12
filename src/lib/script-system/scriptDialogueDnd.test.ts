import { describe, expect, it } from '@jest/globals';
import { resolveDialogueReorder } from './scriptDialogueDnd';

describe('resolveDialogueReorder', () => {
  it('resolves valid dialogue drag ids to branch indexes', () => {
    const ids = ['first', 'second', 'third'];

    expect(resolveDialogueReorder(ids, 'third', 'first')).toEqual({
      fromIndex: 2,
      toIndex: 0,
    });
  });

  it('ignores no-op, missing, and cancelled drops', () => {
    const ids = ['first', 'second', 'third'];

    expect(resolveDialogueReorder(ids, 'first', 'first')).toBeNull();
    expect(resolveDialogueReorder(ids, 'missing', 'second')).toBeNull();
    expect(resolveDialogueReorder(ids, 'first', null)).toBeNull();
  });
});
