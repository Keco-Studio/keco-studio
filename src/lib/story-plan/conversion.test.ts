import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));

import { completeLlm } from '@/lib/agent/llm-client';
import type { StoryContentExtraction, StoryGraphExtraction } from '@/lib/story-extraction/pipeline';
import type { StoryAuditAdjudication, StoryPlanAudit } from './schema';
import {
  DEFAULT_STORY_PLAN_MAX_SOURCE_CHARS,
  STORY_GRAPH_LLM_TIMEOUT_MS,
  STORY_PLOT_LLM_TIMEOUT_MS,
  STORY_PLAN_LLM_TIMEOUT_MS,
  branchPlannerTimeoutMs,
  resolveStoryPlanForImport,
  type StoryPlanLlmTelemetryEvent,
  type StoryPlanProgressEvent,
} from './conversion';
import { segmentStorySource } from './sourceSegments';

const mockedCompleteLlm = completeLlm as jest.MockedFunction<typeof completeLlm>;
const naturalContent = [
  'Seven: We must choose a route.',
  '- Go to the energy bay. Selecting it runs $resolve+=1',
  'You enter the energy bay.',
].join('\n');
const labeledBranchContent = [
  'Seven: We must choose a route.',
  '选择 A（Go to the energy bay.）：$trust+=1',
  'You enter the energy bay.',
].join('\n');
const explicitContent = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);
const passAudit: StoryPlanAudit = { verdict: 'pass', issues: [] };
const naturalCommandId = segmentStorySource(naturalContent, 'fixture').commands[0].id;
const failAudit: StoryPlanAudit = {
  verdict: 'fail',
  issues: [{ code: 'wrong_branch', severity: 'major', unitIds: ['fixture:1'], nodeIds: ['start'], message: 'Choice targets the wrong branch' }],
};
const unsupportedAdjudication: StoryAuditAdjudication = {
  decisions: [{ issueId: 'issue-1', status: 'unsupported' }],
};
const confirmedAdjudication: StoryAuditAdjudication = {
  decisions: [{ issueId: 'issue-1', status: 'confirmed' }],
};

function contentInventory(): StoryContentExtraction {
  return {
    version: 3,
    structuralUnitIds: [],
    nodes: [
      { id: 'start', type: 'dialogue', presentationType: 1, speaker: 'Seven', content: 'We must choose a route.', sourceUnitIds: ['fixture:0'] },
      { id: 'energy', type: 'narration', presentationType: 3, speaker: '', content: 'You enter the energy bay.', sourceUnitIds: ['fixture:2'] },
    ],
    choices: [
      { id: 'go_energy', text: 'Go to the energy bay.', sourceUnitIds: ['fixture:1'] },
    ],
  };
}

function graphPlan(): StoryGraphExtraction {
  return {
    version: 3,
    entryNodeId: 'start',
    nodeLinks: ['start->', 'energy->'],
    choiceLinks: ['go_energy->start->energy'],
    commandLinks: [`${naturalCommandId}->choice->go_energy`],
  };
}

function queueSuccess(audit: StoryPlanAudit = passAudit): void {
  mockedCompleteLlm
    .mockResolvedValueOnce(JSON.stringify(contentInventory()))
    .mockResolvedValueOnce(JSON.stringify(graphPlan()))
    .mockResolvedValueOnce(JSON.stringify(audit));
}

function queueAuditedCandidate(
  audit: StoryPlanAudit,
  adjudication: StoryAuditAdjudication
): void {
  mockedCompleteLlm
    .mockResolvedValueOnce(JSON.stringify(contentInventory()))
    .mockResolvedValueOnce(JSON.stringify(graphPlan()))
    .mockResolvedValueOnce(JSON.stringify(audit))
    .mockResolvedValueOnce(JSON.stringify(adjudication));
}

function providerAbort(): Error {
  return Object.assign(new Error('LLM aborted before completing the response.'), { name: 'LlmError' });
}

describe('two-stage audited story extraction', () => {
  beforeEach(() => mockedCompleteLlm.mockReset());
  afterEach(() => jest.useRealTimers());

  it('uses short deadlines for graph and plot stages', () => {
    expect(STORY_PLAN_LLM_TIMEOUT_MS).toBe(150_000);
    expect(STORY_GRAPH_LLM_TIMEOUT_MS).toBe(30_000);
    expect(STORY_PLOT_LLM_TIMEOUT_MS).toBe(15_000);
  });

  it('gives larger branch stories a longer bounded planning deadline', () => {
    expect(branchPlannerTimeoutMs(2_000, 20)).toBe(45_000);
    expect(branchPlannerTimeoutMs(10_000, 100)).toBe(85_000);
    expect(branchPlannerTimeoutMs(60_000, 500)).toBe(120_000);
  });

  it('accepts up to 60k source characters for chunked extraction', () => {
    expect(DEFAULT_STORY_PLAN_MAX_SOURCE_CHARS).toBe(60_000);
  });

  it('extracts choices without regex inventory, plans the graph, and audits it', async () => {
    expect(segmentStorySource(naturalContent, 'fixture').segments
      .filter((segment) => segment.kind === 'choice_text')).toHaveLength(0);
    queueSuccess();
    const progress: StoryPlanProgressEvent[] = [];

    const result = await resolveStoryPlanForImport(naturalContent, {
      sourceId: 'fixture',
      onProgress: (event) => progress.push(event),
    });

    expect(result.document.nodes[0].options).toHaveLength(1);
    expect(result.approval).toBe('primary_pass');
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_content_inventory',
      'submit_story_graph',
      'submit_story_plan_audit',
    ]);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].maxCompletionTokens)).toEqual([
      24_000,
      6_000,
      10_000,
    ]);
    expect(progress.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'conversion', 'deterministic_validation', 'table_projection', 'semantic_audit', 'complete',
    ]));
  });

  it('sends non-standard labeled branch prose to the AI graph stages instead of linearizing it', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(contentInventory()))
      .mockResolvedValueOnce(JSON.stringify(graphPlan()));

    const result = await resolveStoryPlanForImport(labeledBranchContent, {
      sourceId: 'fixture',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result.document.nodes[0].options).toHaveLength(1);
    expect(result.converted).toBe(true);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_content_inventory',
      'submit_story_graph',
    ]);
  });

  it('fails closed when Graph Planner omits an ordinary tail edge', async () => {
    const source = [
      'Seven: We must choose a route.',
      '- Go to the energy bay.',
      'You enter the energy bay.',
      'The wind follows you outside.',
    ].join('\n');
    const content: StoryContentExtraction = {
      version: 3,
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'dialogue', presentationType: 1, speaker: 'Seven', content: 'We must choose a route.', sourceUnitIds: ['tail:0'] },
        { id: 'energy', type: 'narration', presentationType: 3, speaker: '', content: 'You enter the energy bay.', sourceUnitIds: ['tail:2'] },
        { id: 'narration_wind', type: 'narration', presentationType: 3, speaker: '', content: 'The wind follows you outside.', sourceUnitIds: ['tail:3'] },
      ],
      choices: [{ id: 'go', text: 'Go to the energy bay.', sourceUnitIds: ['tail:1'] }],
    };
    const graph: StoryGraphExtraction = {
      version: 3,
      entryNodeId: 'start',
      nodeLinks: ['start->', 'energy->', 'narration_wind->'],
      choiceLinks: ['go->start->energy'],
      commandLinks: [],
    };
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(content))
      .mockResolvedValueOnce(JSON.stringify(graph))
      .mockResolvedValueOnce(JSON.stringify(graph));

    await expect(resolveStoryPlanForImport(source, {
      sourceId: 'tail',
      skipSemanticAuditAfterValidation: true,
    })).rejects.toThrow(/graph planning failed after 2 attempts/i);

    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_content_inventory',
      'submit_story_graph',
      'submit_story_graph',
    ]);
  });

  it('uses the lightweight Branch Planner and repairs sibling leakage locally', async () => {
    const source = [
      '场景：地铁口。',
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下两把花。',
      '选择 B：不买。',
      '阿城把手缩了回来。',
      '一个月后，阿城再次来到地铁口。',
    ].join('\n');
    const sourceIds = (index: number): string => `short:${index}`;
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
        version: 1,
        structuralUnitIds: [],
        choices: [
          { sourceUnitId: sourceIds(2), text: '选择 A：买。', fromUnitId: sourceIds(1), targetUnitId: sourceIds(3) },
          { sourceUnitId: sourceIds(4), text: '选择 B：不买。', fromUnitId: sourceIds(1), targetUnitId: sourceIds(5) },
        ],
        jumps: [],
        breakAfterUnitIds: [sourceIds(6)],
      }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'short',
      skipSemanticAuditAfterValidation: true,
    });
    const owner = result.document.nodes.find((node) => node.options.length === 2);

    expect(owner?.options.map((option) => option.text)).toEqual(['买。', '不买。']);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure',
    ]);
  });

  it('uses AI-first planning for human-readable explicit branch formats', async () => {
    const source = [
      '【开场对话】',
      '旅人：选择哪条小径？',
      '分支一：选择【青石小径】',
      '旅人走入青石小径。',
      '分支二：选择【灯影小径】',
      '旅人走入灯影小径。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'u1',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'u2', text: '青石小径',
            routeUnitIds: ['u3'], nextUnitId: null,
          },
          {
            sourceUnitId: 'u4', text: '灯影小径',
            routeUnitIds: ['u5'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['u3', 'u5'],
      plotGroups: [
        { title: '迷雾中的选择', sourceUnitIds: ['u0', 'u1'] },
        { title: '青石小径', sourceUnitIds: ['u3'] },
        { title: '灯影小径', sourceUnitIds: ['u5'] },
      ],
    }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'ai-first',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result.plotPlan.nodes.map((node) => node.title)).toEqual([
      '开场对话', '青石小径', '灯影小径',
    ]);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure',
    ]);
    expect(mockedCompleteLlm.mock.calls[0][1].maxCompletionTokens).toBe(24_000);
  });

  it('ignores Branch Planner plot groups when projecting imported Story IR', async () => {
    const source = [
      '场景：地铁口。',
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下两把花。',
      '选择 B：不买。',
      '阿城把手缩了回来。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'u1',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'u2', text: '选择 A：买。',
            routeUnitIds: ['u3'], nextUnitId: null,
          },
          {
            sourceUnitId: 'u4', text: '选择 B：不买。',
            routeUnitIds: ['u5'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['u3', 'u5'],
      plotGroups: [
        { title: '开场', sourceUnitIds: ['u0', 'u1'] },
        { title: '错误的分支B分组', sourceUnitIds: ['u3'] },
        { title: '真正的分支B', sourceUnitIds: ['u5'] },
      ],
    }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'canonical-import-plot',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result.plotPlan.nodes.map((node) => node.title))
      .not.toContain('错误的分支B分组');
    expect(result.plotPlan.edges
      .filter((edge) => edge.optionText)
      .map((edge) => edge.optionText))
      .toEqual(['买。', '不买。']);
  });

  it('reports the source alias and text for a node left unreachable after repairs', async () => {
    const source = [
      '场景：开场。',
      '林远：怎么说服他？',
      '选择 A：用事实证明。',
      '林远拿出了调查记录。',
      '选择 B：用感情唤醒。',
      '林远讲起了共同的往事。',
      '尾声：两人终于踏上归途。',
    ].join('\n');
    const invalid = {
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'u1',
        mergeUnitId: null,
        options: [
          { sourceUnitId: 'u2', text: '用事实证明。', routeUnitIds: ['u3'], nextUnitId: null },
          { sourceUnitId: 'u4', text: '用感情唤醒。', routeUnitIds: ['u5'], nextUnitId: null },
        ],
      }],
      plotGroups: [
        { title: '开场', sourceUnitIds: ['u0', 'u1'] },
        { title: '事实证明', sourceUnitIds: ['u3'] },
        { title: '感情唤醒', sourceUnitIds: ['u5'] },
        { title: '归途', sourceUnitIds: ['u6'] },
      ],
      breakAfterUnitIds: ['u3', 'u5'],
    };
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(invalid))
      .mockResolvedValueOnce(JSON.stringify({
        operations: [{ action: 'add_break', unitId: 'u6' }],
      }));

    await expect(resolveStoryPlanForImport(source, {
      sourceId: 'unreachable-detail',
      skipSemanticAuditAfterValidation: true,
    })).rejects.toThrow(/u6.*尾声.*归途/i);
  });

  it('repairs an unreachable shared suffix with a constrained branch patch', async () => {
    const source = [
      '场景：开场。',
      '林远：怎么说服他？',
      '选择 A：用事实证明。',
      '林远拿出了调查记录。',
      '选择 B：用感情唤醒。',
      '林远讲起了共同的往事。',
      '结局标记：【即时救赎】 —— 林远换回了当下的温情。',
    ].join('\n');
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify({
        version: 2, structuralUnitIds: [], sharedReplayUnitIds: [],
        decisions: [{
          ownerUnitId: 'u1', mergeUnitId: null,
          options: [
            { sourceUnitId: 'u2', text: '用事实证明。', routeUnitIds: ['u3'], nextUnitId: null },
            { sourceUnitId: 'u4', text: '用感情唤醒。', routeUnitIds: ['u5'], nextUnitId: null },
          ],
        }],
        plotGroups: [
          { title: '开场', sourceUnitIds: ['u0', 'u1'] },
          { title: 'A', sourceUnitIds: ['u3'] },
          { title: 'B', sourceUnitIds: ['u5'] },
          { title: '结局', sourceUnitIds: ['u6'] },
        ],
        breakAfterUnitIds: ['u3', 'u5'],
      }))
      .mockResolvedValueOnce(JSON.stringify({ operations: [
        { action: 'set_next', optionRef: 'o0.0', targetUnitId: 'u6' },
        { action: 'set_next', optionRef: 'o0.1', targetUnitId: 'u6' },
        { action: 'set_merge', decisionOwnerUnitId: 'u1', targetUnitId: 'u6' },
      ] }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'patch-shared-ending', skipSemanticAuditAfterValidation: true,
    });

    expect(result.document.nodes.some((node) => node.content.includes('即时救赎'))).toBe(true);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure', 'submit_branch_patch',
    ]);
  });

  it('compiles semantic histories through shared content and exclusive later variants', async () => {
    const source = [
      '王大可：周报怎么写？',
      '选择 A：胡编乱造。',
      '选择 B：硬刚坦白。',
      '王大可：如何应对 AI 警告？',
      '选择 A1：对质。',
      'A1 的前置结局。',
      '选择 A2：自首。',
      'A2 的前置结局。',
      '王大可：如何回应意外走红？',
      '选择 B1：改革。',
      'B1 的前置结局。',
      '选择 B2：道歉。',
      'B2 的前置结局。',
      '所有路线来到同一场颁奖典礼。',
      '来自 A1 的内心独白。',
      '来自 A2 的内心独白。',
      '来自 B1 的内心独白。',
      '来自 B2 的内心独白。',
      '字幕：所有笑话最终都会重逢。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 3,
      structuralUnitIds: [],
      decisions: [
        { id: 'd0', ownerUnitId: 'u0', options: [
          { id: 'oa', sourceUnitId: 'u1', text: '胡编乱造。' },
          { id: 'ob', sourceUnitId: 'u2', text: '硬刚坦白。' },
        ] },
        { id: 'da', ownerUnitId: 'u3', options: [
          { id: 'oa1', sourceUnitId: 'u4', text: '对质。' },
          { id: 'oa2', sourceUnitId: 'u6', text: '自首。' },
        ] },
        { id: 'db', ownerUnitId: 'u8', options: [
          { id: 'ob1', sourceUnitId: 'u9', text: '改革。' },
          { id: 'ob2', sourceUnitId: 'u11', text: '道歉。' },
        ] },
      ],
      histories: [
        { id: 'ha1', optionIds: ['oa', 'oa1'] },
        { id: 'ha2', optionIds: ['oa', 'oa2'] },
        { id: 'hb1', optionIds: ['ob', 'ob1'] },
        { id: 'hb2', optionIds: ['ob', 'ob2'] },
      ],
      unitClaims: [
        { sourceUnitId: 'u0', historyIds: ['ha1', 'ha2', 'hb1', 'hb2'] },
        { sourceUnitId: 'u3', historyIds: ['ha1', 'ha2'] },
        { sourceUnitId: 'u5', historyIds: ['ha1'] },
        { sourceUnitId: 'u7', historyIds: ['ha2'] },
        { sourceUnitId: 'u8', historyIds: ['hb1', 'hb2'] },
        { sourceUnitId: 'u10', historyIds: ['hb1'] },
        { sourceUnitId: 'u12', historyIds: ['hb2'] },
        { sourceUnitId: 'u13', historyIds: ['ha1', 'ha2', 'hb1', 'hb2'] },
        { sourceUnitId: 'u14', historyIds: ['ha1'] },
        { sourceUnitId: 'u15', historyIds: ['ha2'] },
        { sourceUnitId: 'u16', historyIds: ['hb1'] },
        { sourceUnitId: 'u17', historyIds: ['hb2'] },
        { sourceUnitId: 'u18', historyIds: ['ha1', 'ha2', 'hb1', 'hb2'] },
      ],
    }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'semantic-conversion', skipSemanticAuditAfterValidation: true,
    });
    const nodes = new Map(result.document.nodes.map((node) => [node.label, node]));
    const walk = (nodeId: string, seen = new Set<string>()): string[] => {
      const node = nodes.get(nodeId);
      if (!node || seen.has(nodeId)) return [];
      const nextSeen = new Set(seen).add(nodeId);
      if (node.options.length > 0) {
        return node.options.flatMap((option) => walk(option.target, nextSeen)
          .map((path) => `${node.content}\n${path}`));
      }
      if (node.next) return walk(node.next, nextSeen).map((path) => `${node.content}\n${path}`);
      return [node.content];
    };
    const paths = walk(result.document.entryLabel);

    expect(paths).toHaveLength(4);
    expect(result.plotPlan.version).toBe(2);
    for (const marker of ['A1', 'A2', 'B1', 'B2']) {
      const path = paths.find((candidate) => candidate.includes(`来自 ${marker} 的内心独白`));
      expect(path).toContain('所有路线来到同一场颁奖典礼');
      expect(path).not.toMatch(new RegExp(`来自 (?!${marker})[AB][12] 的内心独白`));
    }
  });

  it('repairs explicit branch ownership with a source-targeted semantic patch', async () => {
    const source = [
      '林溪：怎么安慰他？',
      '选择 A：温柔倾听。',
      '选择 B：安静陪伴。',
      '分支 A（温柔倾听）',
      '林溪耐心听完了故事。',
      '分支 B（安静陪伴）',
      '林溪安静地陪在一旁。',
      '两条路径最终都走向和解。',
    ].join('\n');
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify({
        version: 3,
        structuralUnitIds: ['u3', 'u5'],
        decisions: [{
          id: 'd0', ownerUnitId: 'u0', options: [
            { id: 'oa', sourceUnitId: 'u1', text: '温柔倾听。' },
            { id: 'ob', sourceUnitId: 'u2', text: '安静陪伴。' },
          ],
        }],
        histories: [
          { id: 'ha', optionIds: ['oa'] },
          { id: 'hb', optionIds: ['ob'] },
        ],
        unitClaims: [
          { sourceUnitId: 'u0', historyIds: ['ha', 'hb'] },
          { sourceUnitId: 'u4', historyIds: ['ha'] },
          { sourceUnitId: 'u6', historyIds: ['ha'] },
          { sourceUnitId: 'u7', historyIds: ['ha', 'hb'] },
        ],
      }))
      .mockResolvedValueOnce(JSON.stringify({ operations: [{
        action: 'set_unit_histories', unitId: 'u6', historyIds: ['hb'],
      }] }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'semantic-part-repair', skipSemanticAuditAfterValidation: true,
    });

    expect(result.document.nodes.some((node) => node.content.includes('安静地陪在一旁')))
      .toBe(true);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure', 'submit_branch_patch',
    ]);
  });

  it('repairs repeated sibling leakage without falling back to Extractor or Graph Planner', async () => {
    const source = [
      '场景：地铁口。',
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下两把花。',
      '选择 B：不买。',
      '阿城把手缩了回来。',
    ].join('\n');
    const leaking = {
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'branch-stop:2', text: '选择 A：买。', fromUnitId: 'branch-stop:1', targetUnitId: 'branch-stop:3' },
        { sourceUnitId: 'branch-stop:4', text: '选择 B：不买。', fromUnitId: 'branch-stop:1', targetUnitId: 'branch-stop:5' },
      ],
      jumps: [],
      breakAfterUnitIds: ['branch-stop:5'],
    };
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify(leaking));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'branch-stop',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result.document.nodes.find((node) => node.options.length === 2)?.options)
      .toHaveLength(2);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure',
    ]);
  });

  it('uses Branch Planner before Graph Planner for non-standard prose without scene headings', async () => {
    const source = [
      '李明：今天留下，还是现在离开？',
      '可选方案一：留下。',
      '李明收起车票，留在屋里。',
      '可选方案二：离开。',
      '李明拖着箱子走向车站。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'prose:1', text: '可选方案一：留下。', fromUnitId: 'prose:0', targetUnitId: 'prose:2' },
        { sourceUnitId: 'prose:3', text: '可选方案二：离开。', fromUnitId: 'prose:0', targetUnitId: 'prose:4' },
      ],
      jumps: [],
      breakAfterUnitIds: ['prose:2', 'prose:4'],
    }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'prose',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result.document.nodes.find((node) => node.options.length === 2)?.options
      .map((option) => option.text)).toEqual(['留下。', '离开。']);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure',
    ]);
  });

  it('uses Branch Planner for long multi-unit branch stories before chunked extraction', async () => {
    const source = [
      `场景：${'长夜'.repeat(5_100)}`,
      ...Array.from({ length: 19 }, (_, index) => `背景段落 ${index + 1}`),
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下两把花。',
      '选择 B：不买。',
      '阿城把手缩了回来。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'long-branch:21', text: '选择 A：买。', fromUnitId: 'long-branch:20', targetUnitId: 'long-branch:22' },
        { sourceUnitId: 'long-branch:23', text: '选择 B：不买。', fromUnitId: 'long-branch:20', targetUnitId: 'long-branch:24' },
      ],
      jumps: [],
      breakAfterUnitIds: ['long-branch:22', 'long-branch:24'],
    }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'long-branch',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result.document.nodes.find((node) => node.options.length === 2)).toBeDefined();
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure',
    ]);
  });

  it('audits the same character-order presentation Types that are materialized', async () => {
    const source = 'Characters: You (Lamp Keeper), Seafarer Boy\nBoy: The lamp is still lit.\nYou: I know.';
    const content: StoryContentExtraction = {
      version: 3,
      structuralUnitIds: ['roles:0'],
      nodes: [
        { id: 'boy', type: 'dialogue', presentationType: 1, speaker: 'Boy', content: 'The lamp is still lit.', sourceUnitIds: ['roles:1'] },
        { id: 'you', type: 'dialogue', presentationType: 2, speaker: 'You', content: 'I know.', sourceUnitIds: ['roles:2'] },
      ],
      choices: [],
    };
    const graph: StoryGraphExtraction = {
      version: 3,
      entryNodeId: 'boy',
      nodeLinks: ['boy->you', 'you->'],
      choiceLinks: [],
      commandLinks: [],
    };
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(content))
      .mockResolvedValueOnce(JSON.stringify(graph))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(source, { sourceId: 'roles' });

    expect(result.extraction.nodes.map((node) => [node.speaker, node.presentationType]))
      .toEqual([['Boy', 2], ['You', 1]]);
    expect(result.document.nodes.map((node) => [node.speaker, node.presentationType]))
      .toEqual([['Boy', 2], ['You', 1]]);
  });

  it('uses one combined semantic and table audit per candidate', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(contentInventory()))
      .mockResolvedValueOnce(JSON.stringify(graphPlan()))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });

    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_content_inventory',
      'submit_story_graph',
      'submit_story_plan_audit',
    ]);
  });

  it('emits sanitized telemetry for every structured LLM stage', async () => {
    const telemetry: StoryPlanLlmTelemetryEvent[] = [];
    mockedCompleteLlm
      .mockImplementationOnce(async (_messages, options) => {
        options.onResponseMetadata?.({ status: 200, requestId: 'extract-1' });
        return JSON.stringify(contentInventory());
      })
      .mockImplementationOnce(async (_messages, options) => {
        options.onResponseMetadata?.({ status: 200, requestId: 'graph-1' });
        return JSON.stringify(graphPlan());
      })
      .mockImplementationOnce(async (_messages, options) => {
        options.onResponseMetadata?.({ status: 200, requestId: 'audit-1' });
        return JSON.stringify(passAudit);
      });

    await resolveStoryPlanForImport(naturalContent, {
      sourceId: 'fixture',
      onLlmTelemetry: (event) => telemetry.push(event),
    });

    expect(telemetry).toEqual([
      expect.objectContaining({ stage: 'Extractor', attempt: 1, outcome: 'success', requestId: 'extract-1' }),
      expect.objectContaining({ stage: 'Graph Planner', attempt: 1, outcome: 'success', requestId: 'graph-1' }),
      expect.objectContaining({ stage: 'Auditor', attempt: 1, outcome: 'success', requestId: 'audit-1' }),
    ]);
    telemetry.forEach((event) => expect(event.elapsedMs).toEqual(expect.any(Number)));
    expect(JSON.stringify(telemetry)).not.toContain(naturalContent);
  });

  it('uses an explicit structure candidate and calls only the Auditor LLM', async () => {
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(explicitContent, { sourceId: 'explicit' });

    expect(result.converted).toBe(false);
    expect(result.document.nodes.map((node) => node.label)).toEqual([
      'Start', 'O1', 'O1A_END', 'O1B_END', 'O2', 'O2A_END', 'O2B_END', 'Oend',
    ]);
    expect(result.extraction.nodes).toHaveLength(8);
    expect(result.extraction.choices).toHaveLength(6);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_plan_audit',
    ]);
  });

  it('accepts a deterministically validated structure without an Auditor when requested', async () => {
    mockedCompleteLlm.mockRejectedValue(new Error('Auditor should not run'));

    const result = await resolveStoryPlanForImport(explicitContent, {
      sourceId: 'explicit-fast',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result).toMatchObject({
      converted: false,
      approval: 'validation_pass',
      auditSkipped: true,
      audit: { verdict: 'pass', issues: [] },
    });
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('imports explicit multi-level Chinese branches without Extractor or Graph Planner calls', async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/import-script/hierarchical-corridor-story.txt'),
      'utf8'
    );

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'corridor-fast',
      skipSemanticAuditAfterValidation: true,
      enableHeuristicBranchParsing: true,
    });
    const decisionOptions = result.document.nodes
      .filter((node) => node.options.length > 0)
      .map((node) => node.options.map((option) => option.text));

    expect(result.converted).toBe(false);
    expect(decisionOptions).toEqual(expect.arrayContaining([
      ['理性判断', '直觉先行'],
      ['触碰黑镜', '绕行黑镜'],
      ['信任日记，按原序开门', '怀疑日记，按补注顺序调整'],
    ]));
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('imports wrapped act branches and their summary merge without LLM conversion calls', async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/import-script/hierarchical-career-story.txt'),
      'utf8'
    );

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'career-fast',
      skipSemanticAuditAfterValidation: true,
      enableHeuristicBranchParsing: true,
    });
    const decisions = result.document.nodes
      .filter((node) => node.options.length > 0)
      .map((node) => node.options.map((option) => option.text));
    const summary = result.document.nodes.find((node) => node.content.includes('殊途同归'));

    expect(decisions).toEqual(expect.arrayContaining([
      ['选择宏图资本，挑战终面', '选择启航咨询，接受录用'],
      ['接受“快速晋升”项目', '选择稳健的“行业研究”岗位'],
      ['坚持专业操守，拒绝“注水”', '顺应公司文化，学会“包装”'],
    ]));
    expect(result.document.nodes.filter((node) => node.next === summary?.label)).toHaveLength(4);
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('imports successive layered bookstore branches with a reachable final ending', async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/import-script/layered-bookstore-story.txt'),
      'utf8'
    );

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'bookstore-fast',
      skipSemanticAuditAfterValidation: true,
      enableHeuristicBranchParsing: true,
    });
    const decisions = result.document.nodes
      .filter((node) => node.options.length > 0)
      .map((node) => node.options.map((option) => option.text));

    expect(decisions).toEqual(expect.arrayContaining([
      ['温和主动问询', '安静留白陪伴'],
      ['理性剖析利弊', '共情治愈安抚'],
      ['取舍开导', '落地劝解'],
      ['温柔共情宽慰', '温柔兜底劝解'],
    ]));
    const visibleContent = result.document.nodes.map((node) => node.content);
    expect(visibleContent).not.toEqual(expect.arrayContaining([
      '人物',
      expect.stringContaining('旧书店店主'),
      expect.stringContaining('应届毕业生'),
      expect.stringContaining('第一层级双并行分支'),
      expect.stringContaining('并行分支统一汇入'),
      expect.stringContaining('第二层级嵌套分支'),
      expect.stringContaining('所有嵌套分支统一汇聚'),
    ]));
    expect(result.document.nodes.at(-1)?.content).toContain('剧终');
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('imports hypothetical interview decisions without Extractor or duplicate source ownership', async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/import-script/scenario-interview-story.txt'),
      'utf8'
    );

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'interview-fast',
      skipSemanticAuditAfterValidation: true,
      enableHeuristicBranchParsing: true,
    });

    expect(result.converted).toBe(false);
    expect(result.document.nodes.filter((node) => node.options.length > 0).map((node) => (
      node.options.map((option) => option.text)
    ))).toEqual(expect.arrayContaining([
      ['技术深度回答', '技术瓶颈回答'],
      ['诚实回答', '如果李明谎称主动辞职'],
      ['坚持底线', '如果李明立刻妥协', '如果李明强硬拒绝'],
    ]));
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('imports a lettered option menu as sibling branches without LLM conversion', async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/import-script/menu-branch-story.txt'),
      'utf8'
    );

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'menu-fast',
      skipSemanticAuditAfterValidation: true,
      enableHeuristicBranchParsing: true,
    });

    expect(result.converted).toBe(false);
    expect(result.document.nodes.filter((node) => node.options.length > 0).map((node) => (
      node.options.map((option) => option.text)
    ))).toContainEqual(['立刻前往钟楼', '先查阅更多历史档案', '询问陈教授更多细节']);
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('uses one lightweight Plot Planner call when AI plot planning is enabled', async () => {
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      nodes: [{
        title: '\u5b8c\u6574\u5267\u60c5',
        storyNodeIds: ['Start'],
      },
      { title: '\u5de6\u8def', storyNodeIds: ['O1'] },
      { title: '\u5de6\u8def\u7ed3\u5c40A', storyNodeIds: ['O1A_END'] },
      { title: '\u5de6\u8def\u7ed3\u5c40B', storyNodeIds: ['O1B_END'] },
      { title: '\u53f3\u8def', storyNodeIds: ['O2'] },
      { title: '\u53f3\u8def\u7ed3\u5c40A', storyNodeIds: ['O2A_END'] },
      { title: '\u53f3\u8def\u7ed3\u5c40B', storyNodeIds: ['O2B_END'] },
      { title: '\u5408\u6d41', storyNodeIds: ['Oend'] }],
    }));
    const progress: StoryPlanProgressEvent[] = [];

    const result = await resolveStoryPlanForImport(explicitContent, {
      sourceId: 'explicit-ai-plot',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: true,
      onProgress: (event) => progress.push(event),
    });

    expect(result.plotPlan.nodes[0]?.title).toBe('\u5b8c\u6574\u5267\u60c5');
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_plot_grouping',
    ]);
    expect(progress.map((event) => event.phase)).toContain('plot_planning');
  });

  it('falls back immediately when Plot Planner output is invalid', async () => {
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({ nodes: [] }));

    const result = await resolveStoryPlanForImport(explicitContent, {
      sourceId: 'explicit-ai-plot-fallback',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: true,
    });

    expect(result.plotPlan.nodes.length).toBeGreaterThan(1);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(1);
  });

  it('converts Ancient House Chinese branches before AI plot grouping', async () => {
    const ancientHouse = [
      '【\u5f00\u573a\u5bf9\u8bdd】',
      '\u5973\u4e3b：\u5b85\u5185\u6709\u4e24\u5904\u843d\u811a\u5904，\u516c\u5b50\u60f3\u9009\u54ea\u4e00\u5904？',
      '【\u89e6\u53d1\u5206\u652f\u9009\u62e9】',
      '\u5206\u652f\u4e00：\u9009\u62e9【\u4e1c\u4fa7\u5ba2\u623f】（\u5b89\u7a33\u8c28\u614e\u7ebf）',
      '\u7537\u4e3b：\u6211\u9009\u4e1c\u4fa7\u5ba2\u623f。',
      '【\u5206\u652f\u4e00\u7ed3\u5c40：\u5b89\u7a33\u7ed3\u5c40】',
      '\u4e00\u591c\u5b89\u7136\u65e0\u68a6。',
      '\u5206\u652f\u4e8c：\u9009\u62e9【\u897f\u4fa7\u9601\u697c】（\u597d\u5947\u63a2\u9669\u7ebf）',
      '\u7537\u4e3b：\u6211\u9009\u897f\u4fa7\u9601\u697c。',
      '【\u5206\u652f\u4e8c\u7ed3\u5c40：\u7f81\u7eca\u7ed3\u5c40】',
      '\u4f60\u5931\u53bb\u4e86\u4e00\u6bb5\u8bb0\u5fc6。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      nodes: [
        { title: '\u5f00\u573a\u5bf9\u8bdd', storyNodeIds: ['Node1', 'Node2'] },
        { title: '\u89e6\u53d1\u5206\u652f\u9009\u62e9', storyNodeIds: ['Node3'] },
        { title: '\u5b89\u7a33\u8c28\u614e\u7ebf', storyNodeIds: ['Node4', 'Node5', 'Node6'] },
        { title: '\u597d\u5947\u63a2\u9669\u7ebf', storyNodeIds: ['Node7', 'Node8', 'Node9'] },
      ],
    }));

    const result = await resolveStoryPlanForImport(ancientHouse, {
      sourceId: 'ancient-house',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: true,
      enableHeuristicBranchParsing: true,
    });

    expect(result.document.nodes.find((node) => node.label === 'Node3')?.options)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ text: '\u4e1c\u4fa7\u5ba2\u623f', target: 'Node4' }),
        expect.objectContaining({ text: '\u897f\u4fa7\u9601\u697c', target: 'Node7' }),
      ]));
    expect(result.plotPlan.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ optionText: '\u4e1c\u4fa7\u5ba2\u623f', toPlotNodeId: 'Node4' }),
      expect.objectContaining({ optionText: '\u897f\u4fa7\u9601\u697c', toPlotNodeId: 'Node7' }),
    ]));
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName))
      .toEqual(['submit_story_plot_grouping']);
  });

  it('sends bracketed natural-language branch selections to the Branch Planner', async () => {
    const source = [
      '【开场】',
      '女帝：三策当前，卿择其一。',
      '【分支选择一：答布防】',
      '丞相：臣以为，当抚民为先。',
      '【分支一结局：英雄的沉默】',
      '群臣默然。',
      '【分支选择二：回应女帝】',
      '丞相：臣愿为陛下执笔。',
      '【分支二结局：声音的代价】',
      '女帝颔首。',
      '【分支选择三：回应大将军】',
      '丞相：军心不可轻动。',
      '【分支三结局：无名的忠诚】',
      '大将军抱拳。',
      '【最终尾声 - 所有分支汇聚】',
      '史官落下最后一笔。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'natural-bracketed:1',
        mergeUnitId: 'natural-bracketed:14',
        options: [
          {
            sourceUnitId: 'natural-bracketed:2',
            text: '答布防',
            routeUnitIds: ['natural-bracketed:3', 'natural-bracketed:4', 'natural-bracketed:5'],
          },
          {
            sourceUnitId: 'natural-bracketed:6',
            text: '回应女帝',
            routeUnitIds: ['natural-bracketed:7', 'natural-bracketed:8', 'natural-bracketed:9'],
          },
          {
            sourceUnitId: 'natural-bracketed:10',
            text: '回应大将军',
            routeUnitIds: ['natural-bracketed:11', 'natural-bracketed:12', 'natural-bracketed:13'],
          },
        ],
      }],
    }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'natural-bracketed',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: false,
    });

    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName))
      .toEqual(['submit_branch_structure']);
    expect(result.document.nodes.find((node) => node.content.includes('三策当前'))?.options)
      .toHaveLength(3);
  });

  it('uses deterministic plot titles for both panes without a second Plot Planner call', async () => {
    const source = [
      '场景：地铁口。',
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下两把花。',
      '选择 B：不买。',
      '阿城把手缩了回来。',
      '一个月后，阿城再次来到地铁口。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'unified:1',
        mergeUnitId: 'unified:6',
        options: [
          { sourceUnitId: 'unified:2', text: '选择 A：买。', routeUnitIds: ['unified:3'] },
          { sourceUnitId: 'unified:4', text: '选择 B：不买。', routeUnitIds: ['unified:5'] },
        ],
      }],
      plotGroups: [
        { title: '地铁口的选择', sourceUnitIds: ['unified:0', 'unified:1'] },
        { title: '买花路线', sourceUnitIds: ['unified:3'] },
        { title: '放弃路线', sourceUnitIds: ['unified:5'] },
        { title: '一个月后的重逢', sourceUnitIds: ['unified:6'] },
      ],
    }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'unified',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: false,
    });

    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName))
      .toEqual(['submit_branch_structure']);
    expect(result.plotPlan.nodes.map((node) => node.title)).toEqual([
      '剧情 1', '买。', '不买。', '最终汇聚',
    ]);
  });

  it('uses semantic extraction for nested A/B branch markers before plot grouping', async () => {
    const convenienceStore = [
      '【\u51cc\u6668\u4e24\u70b9，\u65e0\u4eba\u4fbf\u5229\u5e97】',
      '\u5206\u652f\u4e00：',
      'A\u9009\u9879（\u4e3b\u52a8\u642d\u8bdd）',
      '\u5c0f\u590f：\u60a8\u597d，\u9700\u8981\u5e2e\u5fd9\u5417？',
      '\u987e\u5ba2：……',
      'B\u9009\u9879（\u6c89\u9ed8\u4e0d\u6253\u6270）',
      '【\u5c0f\u590f\u4e0d\u8bf4\u8bdd，\u4f4e\u5934\u6574\u7406\u6536\u94f6\u53f0\u8d27\u54c1】',
      '\u5206\u652f\u4e8c（A\u9009\u9879\u5d4c\u5957\u4e8c\u7ea7\u5206\u652f）',
      'A1\u5206\u652f（\u9012\u6e29\u6c34）',
      '\u5c0f\u590f：\u591c\u91cc\u98ce\u51c9，\u559d\u70b9\u70ed\u6c34\u5427。',
      '\u987e\u5ba2：\u8c22\u8c22。',
      'A2\u5206\u652f（\u8a00\u8bed\u5b89\u6170）',
      '\u5c0f\u590f：\u522b\u592a\u4e3a\u96be\u81ea\u5df1\u4e86。',
      '\u987e\u5ba2：\u55ef。',
      '\u7edf\u4e00\u5408\u5e76\u7ed3\u5c40（B/A1/A2\u5168\u90e8\u6c47\u5165）',
      '【\u5c0f\u590f\u6ce8\u610f\u5230\u987e\u5ba2\u53e3\u888b\u9732\u51fa\u534a\u5757\u9762\u5305】',
      '\u5c0f\u590f：\u8981\u4e0d\u8981\u6211\u5e2e\u4f60\u52a0\u70ed？',
      '\u987e\u5ba2：\u9ebb\u70e6\u4f60\u4e86。',
    ].join('\n');
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify({
        version: 1,
        structuralUnitIds: ['store:1', 'store:7', 'store:14'],
        choices: [
          { sourceUnitId: 'store:2', text: '\u4e3b\u52a8\u642d\u8bdd', fromUnitId: 'store:0', targetUnitId: 'store:3' },
          { sourceUnitId: 'store:5', text: '\u6c89\u9ed8\u4e0d\u6253\u6270', fromUnitId: 'store:0', targetUnitId: 'store:6' },
          { sourceUnitId: 'store:8', text: '\u9012\u6e29\u6c34', fromUnitId: 'store:4', targetUnitId: 'store:9' },
          { sourceUnitId: 'store:11', text: '\u8a00\u8bed\u5b89\u6170', fromUnitId: 'store:4', targetUnitId: 'store:12' },
        ],
        jumps: [
          { fromUnitId: 'store:6', targetUnitId: 'store:15' },
          { fromUnitId: 'store:10', targetUnitId: 'store:15' },
          { fromUnitId: 'store:13', targetUnitId: 'store:15' },
        ],
        breakAfterUnitIds: ['store:17'],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        nodes: [
          { title: '\u4fbf\u5229\u5e97\u5f00\u573a', storyNodeIds: ['Node1'] },
          { title: '\u4e3b\u52a8\u642d\u8bdd', storyNodeIds: ['Node2', 'Node3'] },
          { title: '\u6c89\u9ed8\u4e0d\u6253\u6270', storyNodeIds: ['Node4'] },
          { title: '\u9012\u6e29\u6c34', storyNodeIds: ['Node5', 'Node6'] },
          { title: '\u8a00\u8bed\u5b89\u6170', storyNodeIds: ['Node7', 'Node8'] },
          { title: '\u7edf\u4e00\u7ed3\u5c40', storyNodeIds: ['Node9', 'Node10', 'Node11'] },
        ],
      }));

    const result = await resolveStoryPlanForImport(convenienceStore, {
      sourceId: 'store',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: true,
    });

    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure',
    ]);
    expect(result.document.nodes.find((node) => node.label === 'Node1')?.options)
      .toHaveLength(2);
    expect(result.document.nodes.find((node) => node.label === 'Node3')?.options)
      .toHaveLength(2);
    expect(result.plotPlan.nodes.length).toBeGreaterThan(0);
    expect(result.plotPlan.nodes.map((node) => node.title)).not.toContain('\u7edf\u4e00\u7ed3\u5c40');
  });

  it('extracts long complex stories in chunks before one global graph call', async () => {
    const longScene = '\u957f\u591c'.repeat(5_500);
    const source = [
      `【${longScene}】`,
      '\u5206\u652f\u4e00：',
      'A\u9009\u9879（\u524d\u8fdb）',
      '\u6797\u9ed8：\u524d\u8fdb。',
      'B\u9009\u9879（\u7b49\u5f85）',
      '\u6797\u9ed8：\u7b49\u5f85。',
    ].join('\n');
    const firstChunk: StoryContentExtraction = {
      version: 3,
      structuralUnitIds: [],
      nodes: [{
        id: 'scene', type: 'scene', presentationType: 4, speaker: '',
        content: longScene, sourceUnitIds: ['long:0'],
      }],
      choices: [],
    };
    const secondChunk: StoryContentExtraction = {
      version: 3,
      structuralUnitIds: ['long:1'],
      nodes: [
        { id: 'a', type: 'dialogue', presentationType: 1, speaker: '\u6797\u9ed8', content: '\u524d\u8fdb。', sourceUnitIds: ['long:3'] },
        { id: 'b', type: 'dialogue', presentationType: 1, speaker: '\u6797\u9ed8', content: '\u7b49\u5f85。', sourceUnitIds: ['long:5'] },
      ],
      choices: [
        { id: 'ca', text: '\u524d\u8fdb', sourceUnitIds: ['long:2'] },
        { id: 'cb', text: '\u7b49\u5f85', sourceUnitIds: ['long:4'] },
      ],
    };
    const graph: StoryGraphExtraction = {
      version: 3,
      entryNodeId: 'C1N1_scene',
      nodeLinks: ['C1N1_scene->', 'C2N1_a->', 'C2N2_b->'],
      choiceLinks: [
        'C2C1_ca->C1N1_scene->C2N1_a',
        'C2C2_cb->C1N1_scene->C2N2_b',
      ],
      commandLinks: [],
    };
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(firstChunk))
      .mockResolvedValueOnce(JSON.stringify(secondChunk))
      .mockResolvedValueOnce(JSON.stringify(graph))
      .mockResolvedValueOnce(JSON.stringify({
        nodes: [
          { title: '\u957f\u591c\u6289\u62e9', storyNodeIds: ['C1N1_scene'] },
          { title: '\u524d\u8fdb', storyNodeIds: ['C2N1_a'] },
          { title: '\u7b49\u5f85', storyNodeIds: ['C2N2_b'] },
        ],
      }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'long',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: true,
    });

    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_content_inventory',
      'submit_story_content_inventory',
      'submit_story_graph',
      'submit_story_plot_grouping',
    ]);
    expect(result.document.nodes[0].options.map((option) => option.text))
      .toEqual(['\u524d\u8fdb', '\u7b49\u5f85']);
  });

  it('skips only the final Auditor after converting arbitrary prose when requested', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(contentInventory()))
      .mockResolvedValueOnce(JSON.stringify(graphPlan()));

    const result = await resolveStoryPlanForImport(naturalContent, {
      sourceId: 'fixture',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result).toMatchObject({
      converted: true,
      approval: 'validation_pass',
      auditSkipped: true,
    });
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_content_inventory',
      'submit_story_graph',
    ]);
  });

  it('normalizes structural duplicates before the Auditor', async () => {
    const content = contentInventory();
    content.structuralUnitIds.push('fixture:0', 'fixture:1');
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(content))
      .mockResolvedValueOnce(JSON.stringify(graphPlan()))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });
    expect(result.extraction.structuralUnitIds).toEqual([]);
    const auditorInput = JSON.parse(mockedCompleteLlm.mock.calls[2][0][1].content as string);
    expect(auditorInput.auditView.structuralUnitIds).toEqual([]);
    expect(auditorInput).not.toHaveProperty('extraction');
    expect(auditorInput).not.toHaveProperty('document');
    expect(auditorInput).not.toHaveProperty('projection');
  });

  it('accepts a Primary Auditor failure only after all allegations are unsupported', async () => {
    queueAuditedCandidate(failAudit, unsupportedAdjudication);

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });

    expect(result.attempts).toBe(1);
    expect(result.approval).toBe('adjudicated_pass');
    expect(result.primaryAudit).toEqual(failAudit);
    expect(result.adjudication).toEqual(unsupportedAdjudication);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_content_inventory',
      'submit_story_graph',
      'submit_story_plan_audit',
      'submit_story_audit_adjudication',
    ]);
  });

  it('repairs only a confirmed Auditor failure with a fresh candidate', async () => {
    queueAuditedCandidate(failAudit, confirmedAdjudication);
    queueSuccess(passAudit);

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });
    expect(result.attempts).toBe(2);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(7);
    expect(mockedCompleteLlm.mock.calls[4][0][1].content).toContain('wrong_branch');
  });

  it('rejects a confirmed defect in an immutable deterministic candidate without re-auditing it', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(failAudit))
      .mockResolvedValueOnce(JSON.stringify(confirmedAdjudication));

    await expect(resolveStoryPlanForImport(explicitContent, { sourceId: 'explicit' }))
      .rejects.toThrow(/confirmed semantic audit/i);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_plan_audit',
      'submit_story_audit_adjudication',
    ]);
  });

  it('fails closed when adjudication does not return one decision per allegation', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(failAudit))
      .mockResolvedValueOnce(JSON.stringify({ decisions: [
        { issueId: 'issue-1', status: 'unsupported' },
        { issueId: 'issue-1', status: 'unsupported' },
      ] }));

    await expect(resolveStoryPlanForImport(explicitContent, { sourceId: 'explicit' }))
      .rejects.toThrow(/adjudication/i);
  });

  it('feeds graph validation issues into Graph Planner retries without rebuilding content', async () => {
    const invalid = contentInventory();
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(invalid))
      .mockResolvedValueOnce(JSON.stringify({
        ...graphPlan(),
        commandLinks: ['missing-command->choice->go_energy'],
      }));
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(graphPlan()))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });
    expect(result.attempts).toBe(1);
    const retryInput = JSON.parse(mockedCompleteLlm.mock.calls[2][0][1].content as string);
    expect(retryInput.priorIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unknown_command' }),
    ]));
    expect(retryInput.previousGraphCandidate).toEqual({
      ...graphPlan(),
      commandLinks: ['missing-command->choice->go_energy'],
    });
    expect(mockedCompleteLlm.mock.calls.filter((call) => (
      call[1].toolName === 'submit_story_content_inventory'
    ))).toHaveLength(1);
  });

  it('uses the third attempt after two malformed Extractor outputs', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify({ item: contentInventory() }))
      .mockResolvedValueOnce(JSON.stringify({ nodes: 'invalid' }));
    queueSuccess();

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });
    expect(result.attempts).toBe(3);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(5);
  });

  it('identifies Graph Planner contract failures', async () => {
    mockedCompleteLlm.mockImplementation(async (_messages, options) => (
      options.toolName === 'submit_story_content_inventory'
        ? JSON.stringify(contentInventory())
        : JSON.stringify({ nodeLinks: 'invalid' })
    ));
    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toMatchObject({
        issues: [expect.objectContaining({ message: expect.stringContaining('Graph Planner') })],
      });
  });

  it('retries a malformed Graph Planner result without rebuilding valid content', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(contentInventory()))
      .mockResolvedValueOnce(JSON.stringify({
        ...graphPlan(),
        choiceLinks: ['go_energy->start->missing'],
      }))
      .mockResolvedValueOnce(JSON.stringify(graphPlan()))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });

    expect(result.attempts).toBe(1);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_content_inventory',
      'submit_story_graph',
      'submit_story_graph',
      'submit_story_plan_audit',
    ]);
  });

  it('stops after two malformed Graph Planner attempts without re-extracting content', async () => {
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify(contentInventory()));
    for (let graphAttempt = 0; graphAttempt < 2; graphAttempt += 1) {
      mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({ nodeLinks: 'invalid' }));
    }

    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toThrow(/graph planning failed after 2 attempts/i);
    expect(mockedCompleteLlm.mock.calls.filter((call) => (
      call[1].toolName === 'submit_story_content_inventory'
    ))).toHaveLength(1);
    expect(mockedCompleteLlm.mock.calls.filter((call) => (
      call[1].toolName === 'submit_story_graph'
    ))).toHaveLength(2);
  });

  it('identifies Auditor contract failures', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      mockedCompleteLlm
        .mockResolvedValueOnce(JSON.stringify(contentInventory()))
        .mockResolvedValueOnce(JSON.stringify(graphPlan()))
        .mockResolvedValueOnce(JSON.stringify({ verdict: 'pass' }));
    }
    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toMatchObject({
        issues: [expect.objectContaining({ message: expect.stringContaining('Auditor') })],
      });
  });

  it('retries provider aborts without consuming the candidate attempt', async () => {
    mockedCompleteLlm.mockRejectedValueOnce(providerAbort());
    queueSuccess();
    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });
    expect(result.attempts).toBe(1);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(4);
  });

  it('fails closed after three rejected audits', async () => {
    queueAuditedCandidate(failAudit, confirmedAdjudication);
    queueAuditedCandidate(failAudit, confirmedAdjudication);
    queueAuditedCandidate(failAudit, confirmedAdjudication);
    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toThrow(/three conversion attempts.*wrong branch/i);
  });

  it('caps provider abort retries per stage so later candidate attempts retain budget', async () => {
    mockedCompleteLlm.mockRejectedValue(providerAbort());
    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toThrow(/three conversion attempts/i);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(12);
  });

  it('rejects oversized or cancelled input before LLM calls', async () => {
    await expect(resolveStoryPlanForImport('Too long', { sourceId: 'fixture', maxSourceChars: 4 }))
      .rejects.toThrow(/too long/i);
    const controller = new AbortController();
    controller.abort();
    await expect(resolveStoryPlanForImport(naturalContent, { signal: controller.signal }))
      .rejects.toThrow(/aborted/i);
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('aborts a timed-out Extractor', async () => {
    jest.useFakeTimers();
    mockedCompleteLlm.mockImplementation(async (_messages, options) =>
      await new Promise<string>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })
    );
    const conversion = resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture', llmTimeoutMs: 25 });
    const rejection = expect(conversion).rejects.toThrow(/timed out.*Extractor/i);
    await jest.advanceTimersByTimeAsync(26);
    await rejection;
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(1);
  });
});
