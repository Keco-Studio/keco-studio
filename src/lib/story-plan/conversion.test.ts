import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));

import { completeLlm } from '@/lib/agent/llm-client';
import type { StoryContentExtraction, StoryGraphExtraction } from '@/lib/story-extraction/pipeline';
import type { StoryAuditAdjudication, StoryPlanAudit } from './schema';
import {
  DEFAULT_STORY_PLAN_MAX_SOURCE_CHARS,
  STORY_PLAN_LLM_TIMEOUT_MS,
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

  it('allows MiniMax up to 150 seconds per structured stage by default', () => {
    expect(STORY_PLAN_LLM_TIMEOUT_MS).toBe(150_000);
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
      10_000,
      10_000,
    ]);
    expect(progress.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'conversion', 'deterministic_validation', 'table_projection', 'semantic_audit', 'complete',
    ]));
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

  it('uses one lightweight Plot Planner call when AI plot planning is enabled', async () => {
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      nodes: [{
        title: '\u5b8c\u6574\u5267\u60c5',
        storyNodeIds: ['Start', 'O1', 'O1A_END', 'O1B_END', 'O2', 'O2A_END', 'O2B_END', 'Oend'],
      }],
    }));
    const progress: StoryPlanProgressEvent[] = [];

    const result = await resolveStoryPlanForImport(explicitContent, {
      sourceId: 'explicit-ai-plot',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: true,
      onProgress: (event) => progress.push(event),
    });

    expect(result.plotPlan.nodes.map((node) => node.title)).toEqual(['\u5b8c\u6574\u5267\u60c5']);
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
    const content: StoryContentExtraction = {
      version: 3,
      structuralUnitIds: ['store:1', 'store:7', 'store:14'],
      nodes: [
        { id: 'scene', type: 'scene', presentationType: 4, speaker: '', content: '\u51cc\u6668\u4e24\u70b9，\u65e0\u4eba\u4fbf\u5229\u5e97', sourceUnitIds: ['store:0'] },
        { id: 'a_clerk', type: 'dialogue', presentationType: 2, speaker: '\u5c0f\u590f', content: '\u60a8\u597d，\u9700\u8981\u5e2e\u5fd9\u5417？', sourceUnitIds: ['store:3'] },
        { id: 'a_customer', type: 'dialogue', presentationType: 1, speaker: '\u987e\u5ba2', content: '……', sourceUnitIds: ['store:4'] },
        { id: 'b_action', type: 'scene', presentationType: 4, speaker: '', content: '\u5c0f\u590f\u4e0d\u8bf4\u8bdd，\u4f4e\u5934\u6574\u7406\u6536\u94f6\u53f0\u8d27\u54c1', sourceUnitIds: ['store:6'] },
        { id: 'a1_clerk', type: 'dialogue', presentationType: 2, speaker: '\u5c0f\u590f', content: '\u591c\u91cc\u98ce\u51c9，\u559d\u70b9\u70ed\u6c34\u5427。', sourceUnitIds: ['store:9'] },
        { id: 'a1_customer', type: 'dialogue', presentationType: 1, speaker: '\u987e\u5ba2', content: '\u8c22\u8c22。', sourceUnitIds: ['store:10'] },
        { id: 'a2_clerk', type: 'dialogue', presentationType: 2, speaker: '\u5c0f\u590f', content: '\u522b\u592a\u4e3a\u96be\u81ea\u5df1\u4e86。', sourceUnitIds: ['store:12'] },
        { id: 'a2_customer', type: 'dialogue', presentationType: 1, speaker: '\u987e\u5ba2', content: '\u55ef。', sourceUnitIds: ['store:13'] },
        { id: 'merge', type: 'scene', presentationType: 4, speaker: '', content: '\u5c0f\u590f\u6ce8\u610f\u5230\u987e\u5ba2\u53e3\u888b\u9732\u51fa\u534a\u5757\u9762\u5305', sourceUnitIds: ['store:15'] },
        { id: 'merge_clerk', type: 'dialogue', presentationType: 2, speaker: '\u5c0f\u590f', content: '\u8981\u4e0d\u8981\u6211\u5e2e\u4f60\u52a0\u70ed？', sourceUnitIds: ['store:16'] },
        { id: 'merge_customer', type: 'dialogue', presentationType: 1, speaker: '\u987e\u5ba2', content: '\u9ebb\u70e6\u4f60\u4e86。', sourceUnitIds: ['store:17'] },
      ],
      choices: [
        { id: 'choice_a', text: '\u4e3b\u52a8\u642d\u8bdd', sourceUnitIds: ['store:2'] },
        { id: 'choice_b', text: '\u6c89\u9ed8\u4e0d\u6253\u6270', sourceUnitIds: ['store:5'] },
        { id: 'choice_a1', text: '\u9012\u6e29\u6c34', sourceUnitIds: ['store:8'] },
        { id: 'choice_a2', text: '\u8a00\u8bed\u5b89\u6170', sourceUnitIds: ['store:11'] },
      ],
    };
    const graph: StoryGraphExtraction = {
      version: 3,
      entryNodeId: 'scene',
      nodeLinks: [
        'scene->', 'a_clerk->a_customer', 'a_customer->', 'b_action->merge',
        'a1_clerk->a1_customer', 'a1_customer->merge',
        'a2_clerk->a2_customer', 'a2_customer->merge',
        'merge->merge_clerk', 'merge_clerk->merge_customer', 'merge_customer->',
      ],
      choiceLinks: [
        'choice_a->scene->a_clerk', 'choice_b->scene->b_action',
        'choice_a1->a_customer->a1_clerk', 'choice_a2->a_customer->a2_clerk',
      ],
      commandLinks: [],
    };
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(content))
      .mockResolvedValueOnce(JSON.stringify(graph))
      .mockResolvedValueOnce(JSON.stringify({
        nodes: [
          { title: '\u4fbf\u5229\u5e97\u5f00\u573a', storyNodeIds: ['scene'] },
          { title: '\u4e3b\u52a8\u642d\u8bdd', storyNodeIds: ['a_clerk', 'a_customer'] },
          { title: '\u6c89\u9ed8\u4e0d\u6253\u6270', storyNodeIds: ['b_action'] },
          { title: '\u9012\u6e29\u6c34', storyNodeIds: ['a1_clerk', 'a1_customer'] },
          { title: '\u8a00\u8bed\u5b89\u6170', storyNodeIds: ['a2_clerk', 'a2_customer'] },
          { title: '\u7edf\u4e00\u7ed3\u5c40', storyNodeIds: ['merge', 'merge_clerk', 'merge_customer'] },
        ],
      }));

    const result = await resolveStoryPlanForImport(convenienceStore, {
      sourceId: 'store',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: true,
    });

    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_content_inventory',
      'submit_story_graph',
      'submit_story_plot_grouping',
    ]);
    expect(result.document.nodes.find((node) => node.label === 'scene')?.options)
      .toHaveLength(2);
    expect(result.document.nodes.find((node) => node.label === 'a_customer')?.options)
      .toHaveLength(2);
    expect(result.plotPlan.nodes.map((node) => node.title)).toContain('\u7edf\u4e00\u7ed3\u5c40');
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

  it('feeds deterministic issues into the next Extractor attempt', async () => {
    const invalid = contentInventory();
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(invalid))
      .mockResolvedValueOnce(JSON.stringify({
        ...graphPlan(),
        commandLinks: ['missing-command->choice->go_energy'],
      }));
    queueSuccess();

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });
    expect(result.attempts).toBe(2);
    expect(mockedCompleteLlm.mock.calls[2][0][1].content).toContain('unknown_command');
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
        nodeLinks: ['start->'],
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

  it('keeps a valid content inventory through a fourth Graph Planner attempt', async () => {
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify(contentInventory()));
    for (let graphAttempt = 0; graphAttempt < 3; graphAttempt += 1) {
      mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({ nodeLinks: 'invalid' }));
    }
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(graphPlan()))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });

    expect(result.attempts).toBe(1);
    expect(mockedCompleteLlm.mock.calls.filter((call) => (
      call[1].toolName === 'submit_story_content_inventory'
    ))).toHaveLength(1);
    expect(mockedCompleteLlm.mock.calls.filter((call) => (
      call[1].toolName === 'submit_story_graph'
    ))).toHaveLength(4);
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
