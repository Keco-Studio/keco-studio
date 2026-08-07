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
import {
  resolveStoryPlanForImport,
  type StoryPlanProgressEvent,
} from '@/lib/story-plan/conversion';
import { compileStoryTable } from '@/lib/story-ir/tableCompiler';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { toScriptImportPlainText } from '@/lib/documents/scriptImportPlainText';

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
// Imports send human-readable formats to the Branch Planner. The natural-language
// parsers stay available as opt-in compatibility helpers, so the cases below that
// assert a zero-AI parse have to request them explicitly.
const compatibilityParsing = { enableHeuristicBranchParsing: true } as const;

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
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify(passAudit));
    const progress: StoryPlanProgressEvent[] = [];

    const resolved = await resolveStoryPlanForImport(rainy, {
      ...compatibilityParsing,
      sourceId: 'rainy',
      onProgress: (event) => progress.push(event),
    });
    const east = play(resolved.document, [0]);
    const west = play(resolved.document, [1]);

    expect(resolved.converted).toBe(false);
    expect(resolved.audit.verdict).toBe('pass');
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(1);
    expect(mockedCompleteLlm.mock.calls[0][1].toolName).toBe('submit_story_plan_audit');
    expect(progress.map((event) => event.message).join('\n')).toContain('deterministic story structure');
    expect(east.contents.join('\n')).toContain('For the rest of your life you remain safe and untroubled');
    expect(east.contents.join('\n')).not.toContain('wholly forgotten why you entered the mountains');
    expect(west.contents.join('\n')).toContain('wholly forgotten why you entered the mountains');
    expect(west.contents.join('\n')).not.toContain('For the rest of your life you remain safe and untroubled');
  });

  it('keeps rainy manor branch isolation on the document-derived validation fast path', async () => {
    mockedCompleteLlm.mockRejectedValue(new Error('LLM should not run'));

    const resolved = await resolveStoryPlanForImport(rainy, {
      ...compatibilityParsing,
      sourceId: 'rainy-fast',
      skipSemanticAuditAfterValidation: true,
    });
    const east = play(resolved.document, [0]);
    const west = play(resolved.document, [1]);

    expect(resolved).toMatchObject({
      approval: 'validation_pass',
      auditSkipped: true,
    });
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
    expect(east.contents.join('\n')).toContain('For the rest of your life you remain safe and untroubled');
    expect(east.contents.join('\n')).not.toContain('wholly forgotten why you entered the mountains');
    expect(west.contents.join('\n')).toContain('wholly forgotten why you entered the mountains');
    expect(west.contents.join('\n')).not.toContain('For the rest of your life you remain safe and untroubled');
  });

});
