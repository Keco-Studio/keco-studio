import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));

import { completeLlm } from '@/lib/agent/llm-client';
import { detectScriptColumns } from '@/components/libraries/utils/tableStructure';
import {
  createScriptPlayerState,
  nextPosition,
} from '@/components/libraries/components/scriptPlayer';
import { resolveStoryPlanForImport } from '@/lib/story-plan/conversion';
import { compileStoryTable } from '@/lib/story-ir/tableCompiler';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { StoryExtraction } from '@/lib/story-extraction/schema';
import { segmentStorySource } from '@/lib/story-plan/sourceSegments';
import { tryParseExplicitStory, tryParseNaturalBranchStory } from '@/lib/story-plan/explicitParser';
import { hydrateStoryDocument } from '@/lib/story-plan/hydrator';

const mockedCompleteLlm = completeLlm as jest.MockedFunction<typeof completeLlm>;
const nested = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);
const rainy = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/rainy-manor-story.txt'),
  'utf8'
);
const passAudit = { verdict: 'pass', issues: [] };

function fixtureExtraction(content: string, sourceId: string): StoryExtraction {
  const source = segmentStorySource(content, sourceId);
  const plan = tryParseExplicitStory(source) ?? tryParseNaturalBranchStory(source);
  if (!plan) throw new Error(`Could not build extraction fixture for ${sourceId}`);
  const document = hydrateStoryDocument(plan, source);
  const generatedLabels = new Set(document.nodes
    .filter((node) => node.structuralRepair?.kind === 'generated_label')
    .map((node) => node.label));
  const nodes = document.nodes
    .filter((node) => !generatedLabels.has(node.label))
    .map((node) => ({
      id: node.label,
      type: node.type,
      speaker: node.speaker ?? '',
      content: node.content,
      sourceUnitIds: node.sourceRefs.map((ref) => ref.unitId),
      commandSources: node.commands.map((command) => command.source),
      nextNodeId: node.next && !generatedLabels.has(node.next) ? node.next : '',
      choices: node.options.map((option) => ({
        text: option.text,
        targetNodeId: option.target,
        sourceUnitIds: option.sourceRefs.map((ref) => ref.unitId),
        commandSources: option.commands.map((command) => command.source),
      })),
    }));
  const visibleUnits = new Set(nodes.flatMap((node) => [
    ...node.sourceUnitIds,
    ...node.choices.flatMap((choice) => choice.sourceUnitIds),
  ]));
  return {
    version: 3,
    entryNodeId: document.entryLabel,
    structuralUnitIds: source.units
      .map((unit) => unit.id)
      .filter((unitId) => !visibleUnits.has(unitId)),
    nodes,
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

function play(document: Awaited<ReturnType<typeof resolveStoryPlanForImport>>['document'], choices: number[]) {
  const table = compileStoryTable(document);
  const rows = tableRows(table.columns, table.rows);
  const columns = detectScriptColumns(properties(table.columns)).scriptColumns;
  const pending = [...choices];
  let state = createScriptPlayerState(rows, columns);
  for (let step = 0; step < 100 && !state.done && !state.error && !state.warning; step += 1) {
    state = state.atChoice
      ? nextPosition(state, rows, columns, pending.shift())
      : nextPosition(state, rows, columns);
  }
  return {
    state,
    labels: state.revealed.map((index) => rows[index].propertyValues.Label),
    contents: state.revealed.map((index) => String(rows[index].propertyValues.Content ?? '')),
  };
}

describe('minimal audited story plan integration', () => {
  beforeEach(() => mockedCompleteLlm.mockReset());

  it('parses explicit nested choices, audits once, and plays all four trust paths', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(fixtureExtraction(nested, 'nested')))
      .mockResolvedValueOnce(JSON.stringify(passAudit));
    const resolved = await resolveStoryPlanForImport(nested, { sourceId: 'nested' });

    expect(resolved.converted).toBe(true);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(2);
    const paths = [
      { choices: [0, 0], trust: 2, excluded: ['O1B_END', 'O2', 'O2A_END', 'O2B_END'] },
      { choices: [0, 1], trust: 0, excluded: ['O1A_END', 'O2', 'O2A_END', 'O2B_END'] },
      { choices: [1, 0], trust: 4, excluded: ['O1', 'O1A_END', 'O1B_END', 'O2B_END'] },
      { choices: [1, 1], trust: 0, excluded: ['O1', 'O1A_END', 'O1B_END', 'O2A_END'] },
    ];
    for (const expected of paths) {
      const result = play(resolved.document, expected.choices);
      expect(result.state.variables.trust).toBe(expected.trust);
      expect(result.labels).toEqual(expect.arrayContaining(['Start', 'Oend']));
      expected.excluded.forEach((label) => expect(result.labels).not.toContain(label));
    }
  });

  it('parses and audits the numbered rainy manor branches with isolated endings', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(fixtureExtraction(rainy, 'rainy')))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const resolved = await resolveStoryPlanForImport(rainy, { sourceId: 'rainy' });
    const east = play(resolved.document, [0]);
    const west = play(resolved.document, [1]);

    expect(resolved.converted).toBe(true);
    expect(resolved.audit.verdict).toBe('pass');
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(2);
    expect(east.contents.join('\n')).toContain('此后余生，你岁岁平安');
    expect(east.contents.join('\n')).not.toContain('彻底遗忘了自己进山的初衷');
    expect(west.contents.join('\n')).toContain('彻底遗忘了自己进山的初衷');
    expect(west.contents.join('\n')).not.toContain('此后余生，你岁岁平安');
  });
});
