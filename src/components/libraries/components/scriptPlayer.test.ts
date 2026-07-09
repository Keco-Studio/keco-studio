import { describe, expect, it } from '@jest/globals';
import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  buildBranchIndex,
  nextPosition,
  type ScriptPlayerState,
} from './scriptPlayer';

const cols = {
  labelKey: 'label',
  contentKey: 'content',
  option0Key: 'option0',
  option0NextKey: 'option0Next',
  option1Key: 'option1',
  option1NextKey: 'option1Next',
  option2Key: 'option2',
  option2NextKey: 'option2Next',
  commandsKey: 'commands',
};

function row(index: number, propertyValues: Record<string, unknown>): AssetRow {
  return {
    id: `row-${index}`,
    libraryId: 'library-1',
    name: `Row ${index}`,
    rowIndex: index,
    propertyValues,
  };
}

const branchingRows = [
  row(0, { label: 'Start', content: 'Opening scene' }),
  row(1, {
    content: 'Which way?',
    option0: 'Take O1',
    option0Next: 'Jump O1',
    option1: 'Take O2',
    option1Next: 'Jump O2',
    option2: 'Take O3',
    option2Next: 'Jump O3',
  }),
  row(2, { label: 'O1', content: 'O1 branch' }),
  row(3, { content: 'O1 line', commands: 'Jump Oend' }),
  row(4, { label: 'O2', content: 'O2 branch' }),
  row(5, { content: 'O2 line', commands: 'Jump Oend' }),
  row(6, { label: 'O3', content: 'O3 branch' }),
  row(7, { content: 'O3 line', commands: 'Jump Oend' }),
  row(8, { label: 'Oend', content: 'Merged ending' }),
];

function initialState(): ScriptPlayerState {
  return {
    currentIndex: 0,
    revealed: [],
    atChoice: false,
    options: [],
    done: false,
  };
}

describe('scriptPlayer', () => {
  it('indexes the first row for each label', () => {
    expect(buildBranchIndex([
      row(0, { label: 'Start' }),
      row(1, { label: 'O1' }),
      row(2, { label: 'O1' }),
    ], cols)).toEqual(new Map([
      ['Start', 0],
      ['O1', 1],
    ]));
  });

  it('plays only the selected branch path after a choice', () => {
    let state = initialState();

    state = nextPosition(state, branchingRows, cols);
    state = nextPosition(state, branchingRows, cols);

    expect(state.atChoice).toBe(true);
    expect(state.options.map((option) => option.text)).toEqual([
      'Take O1',
      'Take O2',
      'Take O3',
    ]);

    state = nextPosition(state, branchingRows, cols, 1);
    expect(state.revealed.map((index) => branchingRows[index].propertyValues.content)).toEqual([
      'Opening scene',
      'Which way?',
      'O2 branch',
    ]);

    state = nextPosition(state, branchingRows, cols);
    state = nextPosition(state, branchingRows, cols);

    expect(state.revealed.map((index) => branchingRows[index].propertyValues.content)).toEqual([
      'Opening scene',
      'Which way?',
      'O2 branch',
      'O2 line',
      'Merged ending',
    ]);
    expect(state.revealed).not.toContain(2);
    expect(state.revealed).not.toContain(3);
    expect(state.revealed).not.toContain(6);
    expect(state.revealed).not.toContain(7);
  });

  it('advances a command jump to the target label row', () => {
    let state: ScriptPlayerState = {
      ...initialState(),
      currentIndex: 5,
    };

    state = nextPosition(state, branchingRows, cols);

    expect(state.warning).toBeUndefined();
    expect(state.currentIndex).toBe(8);
    expect(state.revealed).toEqual([5]);
  });

  it('returns a warning instead of throwing for unresolved jumps', () => {
    const rows = [
      row(0, { label: 'Start', content: 'Start' }),
      row(1, { content: 'Broken jump', commands: 'Jump Missing' }),
    ];
    let state = initialState();

    state = nextPosition(state, rows, cols);
    expect(() => {
      state = nextPosition(state, rows, cols);
    }).not.toThrow();

    expect(state.warning).toContain('Missing');
    expect(state.currentIndex).toBe(1);
    expect(state.done).toBe(false);
  });
});
