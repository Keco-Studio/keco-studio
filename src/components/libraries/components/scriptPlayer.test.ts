import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { compileStoryTable } from '@/lib/story-ir/tableCompiler';
import { tryParseExplicitStory, tryParseNaturalBranchStory } from '@/lib/story-plan/explicitParser';
import { hydrateStoryDocument } from '@/lib/story-plan/hydrator';
import { segmentStorySource } from '@/lib/story-plan/sourceSegments';
import {
  createScriptPlayerState,
  nextPosition,
  readScriptOptions,
  renderPlayerContent,
  type ScriptPlayerColumns,
  type ScriptPlayerState,
} from './scriptPlayer';

const columns: ScriptPlayerColumns = {
  labelKey: 'label',
  commandsKey: 'commands',
  options: [0, 1].map((index) => ({
    index,
    textKey: `option${index}`,
    nextKey: `option${index}Next`,
    commandsKey: `option${index}Commands`,
  })),
};

function row(id: string, values: Record<string, unknown>): AssetRow {
  return { id, libraryId: 'library', name: id, propertyValues: values };
}

function compileFixture(fileName: string) {
  const sourceText = fs.readFileSync(
    path.join(process.cwd(), 'tests/fixtures/import-script', fileName),
    'utf8'
  );
  const source = segmentStorySource(sourceText, fileName);
  const plan = tryParseExplicitStory(source) ?? tryParseNaturalBranchStory(source);
  if (!plan) throw new Error(`Fixture ${fileName} did not produce a story plan`);
  const compiled = compileStoryTable(hydrateStoryDocument(plan, source));
  const rows = compiled.rows.map((values, index) => row(
    `compiled-${index}`,
    Object.fromEntries(compiled.columns.map((column, columnIndex) => [column, values[columnIndex]]))
  ));
  const options = compiled.columns.flatMap((column) => {
    const match = /^Option(\d+)$/.exec(column);
    if (!match) return [];
    const optionIndex = Number(match[1]);
    const commandsKey = `Option${optionIndex}_Commands`;
    return [{
      index: optionIndex,
      textKey: column,
      nextKey: `Option${optionIndex}_Next`,
      ...(compiled.columns.includes(commandsKey) ? { commandsKey } : {}),
    }];
  });
  return {
    rows,
    columns: { labelKey: 'Label', commandsKey: 'Commands', options },
  };
}

function playCompiledFixture(fileName: string, choices: number[]) {
  const compiled = compileFixture(fileName);
  const remaining = [...choices];
  let state = createScriptPlayerState(compiled.rows, compiled.columns);
  for (let step = 0; step < 100 && !state.done && !state.error && !state.warning; step += 1) {
    state = state.atChoice
      ? nextPosition(state, compiled.rows, compiled.columns, remaining.shift())
      : nextPosition(state, compiled.rows, compiled.columns);
  }
  return {
    state,
    content: state.revealed.map((index) => String(
      compiled.rows[index].propertyValues.Content ?? ''
    )).join('\n'),
  };
}

const trustRows = [
  row('start', {
    label: 'Start', content: 'Choose',
    option0: 'Left', option0Next: 'Jump O1', option0Commands: '$trust+=1',
    option1: 'Right', option1Next: 'Jump O2', option1Commands: '$trust+=2',
  }),
  row('o1', {
    label: 'O1', content: 'Left path',
    option0: 'Answer', option0Next: 'Jump O1A_END', option0Commands: '$trust+=1',
    option1: 'Walk away', option1Next: 'Jump O1B_END', option1Commands: '$trust-=1',
  }),
  row('o1a', { label: 'O1A_END', content: 'Honest child', commands: 'Jump Oend' }),
  row('o1b', { label: 'O1B_END', content: 'Rude', commands: 'Jump Oend' }),
  row('o2', {
    label: 'O2', content: 'Right path',
    option0: 'Real name', option0Next: 'Jump O2A_END', option0Commands: '$trust+=2',
    option1: 'Fake name', option1Next: 'Jump O2B_END', option1Commands: '$trust-=2',
  }),
  row('o2a', { label: 'O2A_END', content: 'Enter', commands: 'Jump Oend' }),
  row('o2b', { label: 'O2B_END', content: 'Liar', commands: 'Jump Oend' }),
  row('end', { label: 'Oend', content: 'Trust: [trust]' }),
];

function play(choices: number[]) {
  let state = createScriptPlayerState(trustRows, columns);
  const remaining = [...choices];
  for (let step = 0; step < 30 && !state.done && !state.error && !state.warning; step += 1) {
    state = state.atChoice
      ? nextPosition(state, trustRows, columns, remaining.shift())
      : nextPosition(state, trustRows, columns);
  }
  const rendered = state.revealed.map((index) =>
    renderPlayerContent(trustRows[index], 'content', state.variables)
  );
  const revealedLabels = state.revealed.map((index) => trustRows[index].propertyValues.label);
  return { ...state, rendered, revealedLabels };
}

describe('script player variable runtime', () => {
  it('reads only filled options and exposes their target labels', () => {
    expect(readScriptOptions(row('choice', {
      option0: '  Left path  ',
      option0Next: 'Jump Left',
      option1: '   ',
      option1Next: 'Jump Hidden',
    }), columns)).toEqual([
      { index: 0, text: 'Left path', targetLabel: 'Left', commands: '' },
    ]);
  });

  it.each([
    [[0, 0], 2],
    [[0, 1], 0],
    [[1, 0], 4],
    [[1, 1], 0],
  ])('plays nested path %j with trust %d', (choices, trust) => {
    const result = play(choices);
    expect(result.variables.trust).toBe(trust);
    expect(result.rendered.at(-1)).toContain(String(trust));
  });

  it('does not reveal labels from unselected branches', () => {
    const result = play([1, 0]);
    expect(result.revealedLabels).not.toContain('O1A_END');
    expect(result.revealedLabels).not.toContain('O1B_END');
    expect(result.revealedLabels).not.toContain('O2B_END');
  });

  it('shows_all_twelve_choices', () => {
    const options = Array.from({ length: 12 }, (_, index) => ({
      index,
      textKey: `option${index}`,
      nextKey: `option${index}Next`,
    }));
    const values = Object.fromEntries(options.flatMap(({ index }) => [
      [`option${index}`, `Choice ${index}`],
      [`option${index}Next`, 'Jump End'],
    ]));
    const state = createScriptPlayerState([
      row('start', { label: 'Start', ...values }),
      row('end', { label: 'End', content: 'Done' }),
    ], { labelKey: 'label', options });

    expect(state.options).toHaveLength(12);
    expect(state.options.at(-1)?.index).toBe(11);
  });

  it('executes_node_commands_once', () => {
    const rows = [
      row('start', {
        label: 'Start', commands: '$trust+=1',
        option0: 'Continue', option0Next: 'Jump End',
      }),
      row('end', { label: 'End', content: 'Done' }),
    ];
    let state = createScriptPlayerState(rows, columns);
    expect(state.variables.trust).toBe(1);
    state = nextPosition(state, rows, columns, 0);
    expect(state.variables.trust).toBe(1);
  });

  it('keeps_same_target_option_commands_distinct', () => {
    const rows = [
      row('start', {
        label: 'Start', option0: 'One', option0Next: 'Jump End', option0Commands: '$trust+=1',
        option1: 'Two', option1Next: 'Jump End', option1Commands: '$trust+=2',
      }),
      row('end', { label: 'End', content: 'Done' }),
    ];
    const first = nextPosition(createScriptPlayerState(rows, columns), rows, columns, 0);
    const second = nextPosition(createScriptPlayerState(rows, columns), rows, columns, 1);
    expect(first.variables.trust).toBe(1);
    expect(second.variables.trust).toBe(2);
  });

  it('restart_clears_variables', () => {
    const played = play([1, 0]);
    expect(played.variables.trust).toBe(4);
    expect(createScriptPlayerState(trustRows, columns).variables).toEqual({});
  });

  it('missing_placeholder_is_zero', () => {
    expect(renderPlayerContent(row('line', { content: 'Value: [missing]' }), 'content', {}))
      .toBe('Value: 0');
  });

  it('division_by_zero_stops', () => {
    const state = createScriptPlayerState([
      row('start', { label: 'Start', content: 'Bad', commands: '$trust/=0' }),
    ], columns);
    expect(state.error).toMatch(/zero/i);
    expect(state.done).toBe(true);
  });

  it('invalid_command_stops', () => {
    const state = createScriptPlayerState([
      row('start', { label: 'Start', content: 'Bad', commands: '$trust++' }),
    ], columns);
    expect(state.error).toMatch(/invalid numeric command/i);
    expect(state.done).toBe(true);
  });

  it('ends without revealing a later sibling branch', () => {
    const rows = [
      row('start', {
        label: 'Start',
        option0: 'Left', option0Next: 'Jump Left',
        option1: 'Right', option1Next: 'Jump Right',
      }),
      row('left', { label: 'Left', content: 'Left ending', commands: '$trust+=1; End' }),
      row('right', { label: 'Right', content: 'Right ending', commands: '$trust+=2' }),
    ];

    const state = nextPosition(createScriptPlayerState(rows, columns), rows, columns, 0);

    expect(state.done).toBe(true);
    expect(state.error).toBeUndefined();
    expect(state.variables.trust).toBe(1);
    expect(state.revealed).toEqual([0, 1]);
  });

  it('unresolved_jump_warns', () => {
    const state = createScriptPlayerState([
      row('start', { label: 'Start', content: 'Lost', commands: 'Jump Missing' }),
    ], columns);
    expect(state.warning).toContain('Missing');
    expect(state.error).toBeUndefined();
  });

  it('automatic_cycle_stops', () => {
    const rows = [
      row('a', { label: 'A', content: 'A', commands: 'Jump B' }),
      row('b', { label: 'B', content: 'B', commands: 'Jump A' }),
    ];
    let state: ScriptPlayerState = createScriptPlayerState(rows, columns);
    state = nextPosition(state, rows, columns);
    expect(state.error).toMatch(/cycle/i);
    expect(state.done).toBe(true);
  });
});

describe('visual novel player wiring', () => {
  const viewSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/libraries/components/VisualNovelScriptView.tsx'),
    'utf8'
  );

  it('renders dynamic state, interpolated content, and runtime errors', () => {
    expect(viewSource).toContain('createScriptPlayerState');
    expect(viewSource).toContain('renderPlayerContent(row, contentKey, playerState.variables)');
    expect(viewSource).toContain('playerState.error');
    expect(viewSource).toContain('options,');
  });

  it('shows named actions as chips beside the speaker name', () => {
    expect(viewSource).toContain('actionChip');
    expect(viewSource).toContain('mergedSpeechByActionIndex');
    expect(viewSource).toContain('isNamedActionType');
  });

  it('keeps content on the Start-labelled story node visible', () => {
    expect(viewSource).toContain("label.toLowerCase() === 'start' && !lineContent && !action");
  });

  it('resets plot scrolling only when the selected branch changes', () => {
    expect(viewSource).toContain('[branchKey, mode]');
    expect(viewSource).not.toContain('[filteredRows, mode]');
  });

  it('interpolates editable plot-node dialogue placeholders in view mode', () => {
    expect(viewSource).toContain('displayPlotNodeEditableText(block.dialogue');
    expect(viewSource).toContain('displayPlotNodeEditableText(block.action');
  });

});

describe('compiled story fixture playback', () => {
  it.each([
    [[0, 0], 2],
    [[0, 1], 0],
    [[1, 0], 4],
    [[1, 1], 0],
  ])('preserves nested trust path %j with final trust %d', (choices, trust) => {
    const result = playCompiledFixture('nested-trust-story.txt', choices);
    expect(result.state.error).toBeUndefined();
    expect(result.state.warning).toBeUndefined();
    expect(result.state.done).toBe(true);
    expect(result.state.variables.trust).toBe(trust);
  });

  it('keeps rainy manor east and west endings isolated', () => {
    const east = playCompiledFixture('rainy-manor-story.txt', [0]);
    const west = playCompiledFixture('rainy-manor-story.txt', [1]);

    expect(east.content).toContain('passes without dreams');
    expect(east.content).not.toContain('wholly forgotten');
    expect(west.content).toContain('wholly forgotten');
    expect(west.content).not.toContain('passes without dreams');
    expect(east.state.done).toBe(true);
    expect(west.state.done).toBe(true);
  });
});
