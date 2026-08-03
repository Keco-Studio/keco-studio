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

  it('parses an escaped Chinese Markdown screenplay without any LLM request', async () => {
    mockedCompleteLlm.mockRejectedValue(new Error('LLM should not run'));
    const screenplay = toScriptImportPlainText([
      '\\### \u5267\u60c5\u80cc\u666f',
      '\u5927\u665f\u671d\u5973\u5e1d\u767b\u57fa\u5341\u5e74，\u51b3\u610f\u6325\u5e08\u897f\u8fdb。',
      '\\### 【\u5f00\u573a\u5bf9\u8bdd】',
      '\\*\\*\u5973\u5e1d\\*\\*（\u672a\u56de\u5934，\u6307\u5c16\u8f7b\u6309\u8206\u56fe）：\u6c99\u66b4\u5c01\u4e86\u9000\u8def，\u4e1e\u76f8\u53ef\u62df\u597d\u4e86？',
      '\\*\\*\u4f60\\*\\*：\u56de\u965b\u4e0b，\u5df2\u62df\u6bd5。\u81e3\u8bf7\u79fb\u5e10。',
      '\\### 【\u5206\u652f\u9009\u62e9\u4e00：\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf】',
      '\\*\\*\u4f60\\*\\*（\u62f1\u624b）：\u81e3\u4ee5\u4e3a，\u5f53\u4ee5\u629a\u6c11\u4e3a\u5148。',
      '\\### 【\u5267\u60c5\u8282\u70b9\u4e00：\u5973\u5e1d\u51b3\u65ad】',
      '\\*\\*\u5973\u5e1d\\*\\*（\u56de\u8eab）：\u897f\u5883\u4e09\u57ce，\u8bbe\u519b\u653f\u53cc\u53f8。',
      '\\### 【\u5206\u652f\u9009\u62e9\u4e8c：\u56de\u5e94\u5973\u5e1d——\u5fe0\u541b\u8def\u7ebf】',
      '\\*\\*\u4f60\\*\\*（\u518d\u62dc）：\u81e3\u613f\u4e3a\u965b\u4e0b\u6267\u7b14\u5b89\u5929\u4e0b。',
      '\\### 【\u5267\u60c5\u8282\u70b9\u4e8c：\u6c99\u66b4\u591c\u88ad】',
      '\\*\\*\u5927\u5c06\u519b\\*\\*（\u63d0\u5251\u95ef\u5165）：\u965b\u4e0b，\u8bf7\u79fb\u9a7e\u5185\u57ce。',
      '\\### 【\u5206\u652f\u9009\u62e9\u4e09：\u56de\u5e94\u5927\u5c06\u519b——\u7ed3\u76df\u8def\u7ebf】',
      '\\*\\*\u4f60\\*\\*（\u62b1\u62f3）：\u81e3\u4e0e\u5c06\u519b\u540c\u662f\u965b\u4e0b\u624b\u8db3。',
    ].join('\n\n'));

    const resolved = await resolveStoryPlanForImport(screenplay, {
      sourceId: 'chinese-screenplay',
      skipSemanticAuditAfterValidation: true,
    });

    expect(mockedCompleteLlm).not.toHaveBeenCalled();
    expect(resolved).toMatchObject({
      converted: false,
      approval: 'validation_pass',
      auditSkipped: true,
    });
    const nodes = resolved.document.nodes;
    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'narration',
        speaker: '\u5973\u5e1d',
        content: '\u672a\u56de\u5934，\u6307\u5c16\u8f7b\u6309\u8206\u56fe',
      }),
      expect.objectContaining({
        type: 'dialogue',
        speaker: '\u5973\u5e1d',
        content: '\u6c99\u66b4\u5c01\u4e86\u9000\u8def，\u4e1e\u76f8\u53ef\u62df\u597d\u4e86？',
      }),
    ]));
    const contents = nodes.map((node) => node.content);
    expect(contents).not.toContain('\u672a\u56de\u5934，\u6307\u5c16\u8f7b\u6309\u8206\u56fe\n\u6c99\u66b4\u5c01\u4e86\u9000\u8def，\u4e1e\u76f8\u53ef\u62df\u597d\u4e86？');
    expect(contents).toContain('\u56de\u965b\u4e0b，\u5df2\u62df\u6bd5。\u81e3\u8bf7\u79fb\u5e10。');
    expect(contents).toContain('\u897f\u5883\u4e09\u57ce，\u8bbe\u519b\u653f\u53cc\u53f8。');

    const choiceOwners = nodes.filter((node) => node.options.length > 0);
    expect(choiceOwners).toHaveLength(1);
    expect(choiceOwners[0].options.map((option) => option.text)).toEqual([
      '\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf',
      '\u56de\u5e94\u5973\u5e1d——\u5fe0\u541b\u8def\u7ebf',
      '\u56de\u5e94\u5927\u5c06\u519b——\u7ed3\u76df\u8def\u7ebf',
    ]);
    expect(choiceOwners[0].next).toBeUndefined();
    expect(choiceOwners[0].options.map((option) => {
      const target = nodes.find((candidate) => candidate.label === option.target);
      return [target?.speaker, target?.content];
    })).toEqual([
      ['\u4f60', '\u62f1\u624b'],
      ['\u4f60', '\u518d\u62dc'],
      ['\u4f60', '\u62b1\u62f3'],
    ]);

    const protagonistLines = nodes.filter((node) => node.type === 'dialogue' && node.speaker === '\u4f60');
    const supportingLines = nodes.filter((node) => (
      node.type === 'dialogue' && node.speaker !== '\u4f60'
    ));
    expect(protagonistLines.map((node) => node.presentationType))
      .toEqual(protagonistLines.map(() => 1));
    expect(supportingLines.map((node) => node.presentationType))
      .toEqual(supportingLines.map(() => 2));

    const routes = [0, 1, 2].map((choice) => play(resolved.document, [choice]).contents.join('\n'));
    expect(routes[0]).toContain('\u81e3\u4ee5\u4e3a，\u5f53\u4ee5\u629a\u6c11\u4e3a\u5148。');
    expect(routes[0]).not.toContain('\u81e3\u613f\u4e3a\u965b\u4e0b\u6267\u7b14\u5b89\u5929\u4e0b。');
    expect(routes[0]).not.toContain('\u81e3\u4e0e\u5c06\u519b\u540c\u662f\u965b\u4e0b\u624b\u8db3。');
    expect(routes[1]).not.toContain('\u81e3\u4ee5\u4e3a，\u5f53\u4ee5\u629a\u6c11\u4e3a\u5148。');
    expect(routes[1]).toContain('\u81e3\u613f\u4e3a\u965b\u4e0b\u6267\u7b14\u5b89\u5929\u4e0b。');
    expect(routes[1]).not.toContain('\u81e3\u4e0e\u5c06\u519b\u540c\u662f\u965b\u4e0b\u624b\u8db3。');
    expect(routes[2]).not.toContain('\u81e3\u4ee5\u4e3a，\u5f53\u4ee5\u629a\u6c11\u4e3a\u5148。');
    expect(routes[2]).not.toContain('\u81e3\u613f\u4e3a\u965b\u4e0b\u6267\u7b14\u5b89\u5929\u4e0b。');
    expect(routes[2]).toContain('\u81e3\u4e0e\u5c06\u519b\u540c\u662f\u965b\u4e0b\u624b\u8db3。');
  });
});
