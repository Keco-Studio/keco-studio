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
import type { StoryContentExtraction, StoryGraphExtraction } from '@/lib/story-extraction/pipeline';
import { segmentStorySource, type SegmentedStorySource } from '@/lib/story-plan/sourceSegments';
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
  const sourceNodes = document.nodes
    .filter((node) => !generatedLabels.has(node.label));
  const nodes = sourceNodes.map((node) => ({
      id: node.label,
      type: node.type,
      speaker: node.speaker ?? '',
      content: node.content,
      sourceUnitIds: node.sourceRefs.map((ref) => ref.unitId),
      commandSources: node.commands.map((command) => command.source),
      nextNodeId: node.next && !generatedLabels.has(node.next) ? node.next : '',
    }));
  const choices = sourceNodes.flatMap((node) => node.options.map((option, index) => ({
    id: `${node.label}_choice_${index}`,
    fromNodeId: node.label,
    text: option.text,
    targetNodeId: option.target,
    sourceUnitIds: option.sourceRefs.map((ref) => ref.unitId),
    commandSources: option.commands.map((command) => command.source),
  })));
  const visibleUnits = new Set([
    ...nodes.flatMap((node) => node.sourceUnitIds),
    ...choices.flatMap((choice) => choice.sourceUnitIds),
  ]);
  return {
    version: 3,
    entryNodeId: document.entryLabel,
    structuralUnitIds: source.units
      .map((unit) => unit.id)
      .filter((unitId) => !visibleUnits.has(unitId)),
    nodes,
    choices,
  };
}

function splitFixtureExtraction(
  extraction: StoryExtraction,
  source: SegmentedStorySource
): {
  content: StoryContentExtraction;
  graph: StoryGraphExtraction;
} {
  const dialogueTypes = new Map<string, 1 | 2>();
  extraction.nodes.forEach((node) => {
    if (node.type !== 'dialogue' || node.presentationType) return;
    const speaker = node.speaker.trim();
    if (!dialogueTypes.has(speaker)) {
      dialogueTypes.set(speaker, dialogueTypes.size === 0 ? 1 : 2);
    }
  });
  const commandIds = (sources: string[], unitIds: string[]) => sources.map((commandSource) => {
    const command = source.commands.find((candidate) => {
      const unitId = source.segments.find((segment) => segment.id === candidate.segmentId)?.unitId;
      return candidate.source.replace(/\s+/g, '') === commandSource.replace(/\s+/g, '')
        && Boolean(unitId && unitIds.includes(unitId));
    });
    if (!command) throw new Error(`Could not locate command ref for ${commandSource}`);
    return command.id;
  });
  return {
    content: {
      version: 3,
      structuralUnitIds: extraction.structuralUnitIds,
      nodes: extraction.nodes.map(({ nextNodeId: _nextNodeId, commandSources: _commandSources, ...node }) => ({
        ...node,
        presentationType: node.presentationType ?? (
          node.type === 'dialogue'
            ? dialogueTypes.get(node.speaker.trim()) ?? 1
            : node.type === 'scene' ? 4 : node.type === 'system' ? 5 : 3
        ),
      })),
      choices: extraction.choices.map(({
        fromNodeId: _fromNodeId,
        targetNodeId: _targetNodeId,
        commandSources: _commandSources,
        ...choice
      }) => ({
        ...choice,
      })),
    },
    graph: {
      version: 3,
      entryNodeId: extraction.entryNodeId,
      nodeLinks: extraction.nodes.map((node) => `${node.id}->${node.nextNodeId}`),
      choiceLinks: extraction.choices.map((choice) => (
        `${choice.id}->${choice.fromNodeId}->${choice.targetNodeId}`
      )),
      commandLinks: [
        ...extraction.nodes.flatMap((node) => commandIds(
          node.commandSources,
          node.sourceUnitIds
        ).map((unitId) => `${unitId}->node->${node.id}`)),
        ...extraction.choices.flatMap((choice) => commandIds(
          choice.commandSources,
          choice.sourceUnitIds
        ).map((unitId) => `${unitId}->choice->${choice.id}`)),
      ],
    },
  };
}

function queueFixture(content: string, sourceId: string): void {
  const extraction = splitFixtureExtraction(
    fixtureExtraction(content, sourceId),
    segmentStorySource(content, sourceId)
  );
  mockedCompleteLlm
    .mockResolvedValueOnce(JSON.stringify(extraction.content))
    .mockResolvedValueOnce(JSON.stringify(extraction.graph))
    .mockResolvedValueOnce(JSON.stringify(passAudit))
    .mockResolvedValueOnce(JSON.stringify(passAudit))
    .mockResolvedValueOnce(JSON.stringify(passAudit))
    .mockResolvedValueOnce(JSON.stringify(passAudit));
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
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify(passAudit));
    const resolved = await resolveStoryPlanForImport(nested, { sourceId: 'nested' });

    expect(resolved.converted).toBe(false);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(1);
    expect(mockedCompleteLlm.mock.calls[0][1].toolName).toBe('submit_story_plan_audit');
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
    queueFixture(rainy, 'rainy');

    const resolved = await resolveStoryPlanForImport(rainy, { sourceId: 'rainy' });
    const east = play(resolved.document, [0]);
    const west = play(resolved.document, [1]);

    expect(resolved.converted).toBe(true);
    expect(resolved.audit.verdict).toBe('pass');
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(6);
    expect(east.contents.join('\n')).toContain('此后余生，你岁岁平安');
    expect(east.contents.join('\n')).not.toContain('彻底遗忘了自己进山的初衷');
    expect(west.contents.join('\n')).toContain('彻底遗忘了自己进山的初衷');
    expect(west.contents.join('\n')).not.toContain('此后余生，你岁岁平安');
  });
});
