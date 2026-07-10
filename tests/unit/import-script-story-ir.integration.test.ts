import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));

import { completeLlm } from '@/lib/agent/llm-client';
import { detectScriptColumns } from '@/components/libraries/utils/tableStructure';
import {
  createScriptPlayerState,
  nextPosition,
  renderPlayerContent,
} from '@/components/libraries/components/scriptPlayer';
import { resolveStoryForImport } from '@/lib/story-ir/conversion';
import { tryLegacyStoryImport } from '@/lib/story-ir/legacyAdapter';
import type { SourceUnit, StoryCommand, StoryDocument } from '@/lib/story-ir/schema';
import { sourceRefForUnit, unitizeSource } from '@/lib/story-ir/sourceUnits';
import { compileStoryTable } from '@/lib/story-ir/tableCompiler';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const mockedCompleteLlm = completeLlm as jest.MockedFunction<typeof completeLlm>;
const source = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);

function convertedDocument(units: SourceUnit[]): StoryDocument {
  const refs = (...indexes: number[]) => indexes.map((index) => sourceRefForUnit(units[index]));
  const command = (unitIndex: number, commandSource: string): StoryCommand => ({
    source: commandSource,
    ...parseCommand(commandSource),
    sourceRefs: refs(unitIndex),
  });
  return {
    version: 1,
    entryLabel: 'Start',
    nodes: [
      {
        label: 'Start', type: 'dialogue', speaker: '光球', content: '你醒了。选一条路。',
        commands: [], sourceRefs: refs(0, 1, 2),
        options: [
          { text: '走左边。', target: 'O1', commands: [command(1, '$trust+=1')], sourceRefs: refs(1) },
          { text: '走右边。', target: 'O2', commands: [command(2, '$trust+=2')], sourceRefs: refs(2) },
        ],
      },
      {
        label: 'O1', type: 'dialogue', speaker: '老人', content: '年轻人，你从哪来？',
        commands: [], sourceRefs: refs(3, 4, 5, 6),
        options: [
          { text: '回答“我不知道”。', target: 'O1A_END', commands: [command(5, '$trust+=1')], sourceRefs: refs(5) },
          { text: '不回答直接走。', target: 'O1B_END', commands: [command(6, '$trust-=1')], sourceRefs: refs(6) },
        ],
      },
      {
        label: 'O1A_END', type: 'dialogue', speaker: '老人', content: '诚实的孩子。',
        commands: [], next: 'Oend', options: [], sourceRefs: refs(7, 8, 9),
      },
      {
        label: 'O1B_END', type: 'dialogue', speaker: '老人', content: '没礼貌啊。',
        commands: [], next: 'Oend', options: [], sourceRefs: refs(10, 11, 12),
      },
      {
        label: 'O2', type: 'dialogue', speaker: '守卫', content: '站住！报上名来。',
        commands: [], sourceRefs: refs(13, 14, 15, 16),
        options: [
          { text: '报真名。', target: 'O2A_END', commands: [command(15, '$trust+=2')], sourceRefs: refs(15) },
          { text: '报假名。', target: 'O2B_END', commands: [command(16, '$trust-=2')], sourceRefs: refs(16) },
        ],
      },
      {
        label: 'O2A_END', type: 'dialogue', speaker: '守卫', content: '进去吧。',
        commands: [], next: 'Oend', options: [], sourceRefs: refs(17, 18, 19),
      },
      {
        label: 'O2B_END', type: 'dialogue', speaker: '守卫', content: '你在撒谎。',
        commands: [], next: 'Oend', options: [], sourceRefs: refs(20, 21, 22),
      },
      {
        label: 'Oend', type: 'dialogue', speaker: '光球', content: '你到了。信任值: [trust]。',
        commands: [], options: [], sourceRefs: refs(23, 24),
      },
    ],
  };
}

function parseCommand(source: string) {
  const match = /^\$([A-Za-z_]\w*)(\+=|-=)(-?\d+)$/.exec(source);
  if (!match) throw new Error(`Bad test command: ${source}`);
  return {
    variable: match[1],
    operator: match[2] as '+=' | '-=',
    value: Number(match[3]),
  };
}

function tableRows(columns: string[], rows: string[][]): AssetRow[] {
  return rows.map((values, rowIndex) => ({
    id: `row-${rowIndex}`,
    libraryId: 'library',
    name: values[0] || `row-${rowIndex}`,
    propertyValues: Object.fromEntries(columns.map((column, index) => [column, values[index]])),
  }));
}

function properties(columns: string[]): PropertyConfig[] {
  return columns.map((name, orderIndex) => ({
    id: name,
    sectionId: 'section',
    key: name,
    name,
    valueType: 'string',
    dataType: 'string',
    orderIndex,
  }));
}

function play(rows: AssetRow[], choices: number[], playerColumns: ReturnType<typeof detectScriptColumns>['scriptColumns']) {
  let state = createScriptPlayerState(rows, playerColumns);
  const pending = [...choices];
  for (let step = 0; step < 30 && !state.done && !state.error && !state.warning; step += 1) {
    state = state.atChoice
      ? nextPosition(state, rows, playerColumns, pending.shift())
      : nextPosition(state, rows, playerColumns);
  }
  return {
    ...state,
    ending: renderPlayerContent(rows[state.revealed.at(-1)!], playerColumns.contentKey, state.variables),
    labels: state.revealed.map((index) => rows[index].propertyValues.Label),
  };
}

describe('audited nested script import integration', () => {
  beforeEach(() => mockedCompleteLlm.mockReset());

  it('converts the exact source, compiles dynamic commands, and plays all four paths', async () => {
    const units = unitizeSource(source, 'fixture');
    const document = convertedDocument(units);
    expect(tryLegacyStoryImport(source, 'fixture')).toBeNull();
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(document))
      .mockResolvedValueOnce(JSON.stringify({ verdict: 'pass', issues: [] }));

    const resolved = await resolveStoryForImport(source, { sourceId: 'fixture' });
    expect(resolved.converted).toBe(true);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(2);

    const table = compileStoryTable(resolved.document);
    expect(table.columns).toEqual(expect.arrayContaining([
      'Option0', 'Option0_Next', 'Option0_Commands',
      'Option1', 'Option1_Next', 'Option1_Commands',
    ]));
    expect(table.rows[0][table.columns.indexOf('Option0_Commands')]).toBe('$trust+=1');

    const detected = detectScriptColumns(properties(table.columns));
    const rows = tableRows(table.columns, table.rows);
    const paths = [
      { choices: [0, 0], trust: 2, excluded: ['O1B_END', 'O2', 'O2A_END', 'O2B_END'] },
      { choices: [0, 1], trust: 0, excluded: ['O1A_END', 'O2', 'O2A_END', 'O2B_END'] },
      { choices: [1, 0], trust: 4, excluded: ['O1', 'O1A_END', 'O1B_END', 'O2B_END'] },
      { choices: [1, 1], trust: 0, excluded: ['O1', 'O1A_END', 'O1B_END', 'O2A_END'] },
    ];

    for (const expected of paths) {
      const result = play(rows, expected.choices, detected.scriptColumns);
      expect(result.variables.trust).toBe(expected.trust);
      expect(result.ending).toContain(String(expected.trust));
      expect(result.labels).toEqual(expect.arrayContaining(['Start', 'Oend']));
      expected.excluded.forEach((label) => expect(result.labels).not.toContain(label));
    }
  });
});
