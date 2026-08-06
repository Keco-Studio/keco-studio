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
  '\u9009\u62e9 A（Go to the energy bay.）：$trust+=1',
  'You enter the energy bay.',
].join('\n');
const explicitContent = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);

// Scripts written in Chinese are stored as JSON so their characters stay
// escaped on disk; `lines` round-trips to the exact original text.
function readEscapedScriptFixture(name: string): string {
  const raw = fs.readFileSync(
    path.join(process.cwd(), `tests/fixtures/import-script/${name}.json`),
    'utf8'
  );
  return (JSON.parse(raw) as { lines: string[] }).lines.join('\n');
}

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
      '\u573a\u666f：\u5730\u94c1\u53e3。',
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u628a\u624b\u7f29\u4e86\u56de\u6765。',
      '\u4e00\u4e2a\u6708\u540e，\u963f\u57ce\u518d\u6b21\u6765\u5230\u5730\u94c1\u53e3。',
    ].join('\n');
    const sourceIds = (index: number): string => `short:${index}`;
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
        version: 1,
        structuralUnitIds: [],
        choices: [
          { sourceUnitId: sourceIds(2), text: '\u9009\u62e9 A：\u4e70。', fromUnitId: sourceIds(1), targetUnitId: sourceIds(3) },
          { sourceUnitId: sourceIds(4), text: '\u9009\u62e9 B：\u4e0d\u4e70。', fromUnitId: sourceIds(1), targetUnitId: sourceIds(5) },
        ],
        jumps: [],
        breakAfterUnitIds: [sourceIds(6)],
      }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'short',
      skipSemanticAuditAfterValidation: true,
    });
    const owner = result.document.nodes.find((node) => node.options.length === 2);

    expect(owner?.options.map((option) => option.text)).toEqual(['\u4e70。', '\u4e0d\u4e70。']);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure',
    ]);
  });

  it('uses AI-first planning for human-readable explicit branch formats', async () => {
    const source = [
      '【\u5f00\u573a\u5bf9\u8bdd】',
      '\u65c5\u4eba：\u9009\u62e9\u54ea\u6761\u5c0f\u5f84？',
      '\u5206\u652f\u4e00：\u9009\u62e9【\u9752\u77f3\u5c0f\u5f84】',
      '\u65c5\u4eba\u8d70\u5165\u9752\u77f3\u5c0f\u5f84。',
      '\u5206\u652f\u4e8c：\u9009\u62e9【\u706f\u5f71\u5c0f\u5f84】',
      '\u65c5\u4eba\u8d70\u5165\u706f\u5f71\u5c0f\u5f84。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'u1',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'u2', text: '\u9752\u77f3\u5c0f\u5f84',
            routeUnitIds: ['u3'], nextUnitId: null,
          },
          {
            sourceUnitId: 'u4', text: '\u706f\u5f71\u5c0f\u5f84',
            routeUnitIds: ['u5'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['u3', 'u5'],
      plotGroups: [
        { title: '\u8ff7\u96fe\u4e2d\u7684\u9009\u62e9', sourceUnitIds: ['u0', 'u1'] },
        { title: '\u9752\u77f3\u5c0f\u5f84', sourceUnitIds: ['u3'] },
        { title: '\u706f\u5f71\u5c0f\u5f84', sourceUnitIds: ['u5'] },
      ],
    }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'ai-first',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result.plotPlan.nodes.map((node) => node.title)).toEqual([
      '\u5f00\u573a\u5bf9\u8bdd', '\u9752\u77f3\u5c0f\u5f84', '\u706f\u5f71\u5c0f\u5f84',
    ]);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure',
    ]);
    expect(mockedCompleteLlm.mock.calls[0][1].maxCompletionTokens).toBe(24_000);
  });

  it('ignores Branch Planner plot groups when projecting imported Story IR', async () => {
    const source = [
      '\u573a\u666f：\u5730\u94c1\u53e3。',
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u628a\u624b\u7f29\u4e86\u56de\u6765。',
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
            sourceUnitId: 'u2', text: '\u9009\u62e9 A：\u4e70。',
            routeUnitIds: ['u3'], nextUnitId: null,
          },
          {
            sourceUnitId: 'u4', text: '\u9009\u62e9 B：\u4e0d\u4e70。',
            routeUnitIds: ['u5'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['u3', 'u5'],
      plotGroups: [
        { title: '\u5f00\u573a', sourceUnitIds: ['u0', 'u1'] },
        { title: '\u9519\u8bef\u7684\u5206\u652fB\u5206\u7ec4', sourceUnitIds: ['u3'] },
        { title: '\u771f\u6b63\u7684\u5206\u652fB', sourceUnitIds: ['u5'] },
      ],
    }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'canonical-import-plot',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result.plotPlan.nodes.map((node) => node.title))
      .not.toContain('\u9519\u8bef\u7684\u5206\u652fB\u5206\u7ec4');
    expect(result.plotPlan.edges
      .filter((edge) => edge.optionText)
      .map((edge) => edge.optionText))
      .toEqual(['\u4e70。', '\u4e0d\u4e70。']);
  });

  it('reports the source alias and text for a node left unreachable after repairs', async () => {
    const source = [
      '\u573a\u666f：\u5f00\u573a。',
      '\u6797\u8fdc：\u600e\u4e48\u8bf4\u670d\u4ed6？',
      '\u9009\u62e9 A：\u7528\u4e8b\u5b9e\u8bc1\u660e。',
      '\u6797\u8fdc\u62ff\u51fa\u4e86\u8c03\u67e5\u8bb0\u5f55。',
      '\u9009\u62e9 B：\u7528\u611f\u60c5\u5524\u9192。',
      '\u6797\u8fdc\u8bb2\u8d77\u4e86\u5171\u540c\u7684\u5f80\u4e8b。',
      '\u5c3e\u58f0：\u4e24\u4eba\u7ec8\u4e8e\u8e0f\u4e0a\u5f52\u9014。',
    ].join('\n');
    const invalid = {
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'u1',
        mergeUnitId: null,
        options: [
          { sourceUnitId: 'u2', text: '\u7528\u4e8b\u5b9e\u8bc1\u660e。', routeUnitIds: ['u3'], nextUnitId: null },
          { sourceUnitId: 'u4', text: '\u7528\u611f\u60c5\u5524\u9192。', routeUnitIds: ['u5'], nextUnitId: null },
        ],
      }],
      plotGroups: [
        { title: '\u5f00\u573a', sourceUnitIds: ['u0', 'u1'] },
        { title: '\u4e8b\u5b9e\u8bc1\u660e', sourceUnitIds: ['u3'] },
        { title: '\u611f\u60c5\u5524\u9192', sourceUnitIds: ['u5'] },
        { title: '\u5f52\u9014', sourceUnitIds: ['u6'] },
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
    })).rejects.toThrow(/u6.*\u5c3e\u58f0.*\u5f52\u9014/i);
  });

  it('repairs an unreachable shared suffix with a constrained branch patch', async () => {
    const source = [
      '\u573a\u666f：\u5f00\u573a。',
      '\u6797\u8fdc：\u600e\u4e48\u8bf4\u670d\u4ed6？',
      '\u9009\u62e9 A：\u7528\u4e8b\u5b9e\u8bc1\u660e。',
      '\u6797\u8fdc\u62ff\u51fa\u4e86\u8c03\u67e5\u8bb0\u5f55。',
      '\u9009\u62e9 B：\u7528\u611f\u60c5\u5524\u9192。',
      '\u6797\u8fdc\u8bb2\u8d77\u4e86\u5171\u540c\u7684\u5f80\u4e8b。',
      '\u7ed3\u5c40\u6807\u8bb0：【\u5373\u65f6\u6551\u8d4e】 —— \u6797\u8fdc\u6362\u56de\u4e86\u5f53\u4e0b\u7684\u6e29\u60c5。',
    ].join('\n');
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify({
        version: 2, structuralUnitIds: [], sharedReplayUnitIds: [],
        decisions: [{
          ownerUnitId: 'u1', mergeUnitId: null,
          options: [
            { sourceUnitId: 'u2', text: '\u7528\u4e8b\u5b9e\u8bc1\u660e。', routeUnitIds: ['u3'], nextUnitId: null },
            { sourceUnitId: 'u4', text: '\u7528\u611f\u60c5\u5524\u9192。', routeUnitIds: ['u5'], nextUnitId: null },
          ],
        }],
        plotGroups: [
          { title: '\u5f00\u573a', sourceUnitIds: ['u0', 'u1'] },
          { title: 'A', sourceUnitIds: ['u3'] },
          { title: 'B', sourceUnitIds: ['u5'] },
          { title: '\u7ed3\u5c40', sourceUnitIds: ['u6'] },
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

    expect(result.document.nodes.some((node) => node.content.includes('\u5373\u65f6\u6551\u8d4e'))).toBe(true);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure', 'submit_branch_patch',
    ]);
  });

  it('compiles semantic histories through shared content and exclusive later variants', async () => {
    const source = [
      '\u738b\u5927\u53ef：\u5468\u62a5\u600e\u4e48\u5199？',
      '\u9009\u62e9 A：\u80e1\u7f16\u4e71\u9020。',
      '\u9009\u62e9 B：\u786c\u521a\u5766\u767d。',
      '\u738b\u5927\u53ef：\u5982\u4f55\u5e94\u5bf9 AI \u8b66\u544a？',
      '\u9009\u62e9 A1：\u5bf9\u8d28。',
      'A1 \u7684\u524d\u7f6e\u7ed3\u5c40。',
      '\u9009\u62e9 A2：\u81ea\u9996。',
      'A2 \u7684\u524d\u7f6e\u7ed3\u5c40。',
      '\u738b\u5927\u53ef：\u5982\u4f55\u56de\u5e94\u610f\u5916\u8d70\u7ea2？',
      '\u9009\u62e9 B1：\u6539\u9769。',
      'B1 \u7684\u524d\u7f6e\u7ed3\u5c40。',
      '\u9009\u62e9 B2：\u9053\u6b49。',
      'B2 \u7684\u524d\u7f6e\u7ed3\u5c40。',
      '\u6240\u6709\u8def\u7ebf\u6765\u5230\u540c\u4e00\u573a\u9881\u5956\u5178\u793c。',
      '\u6765\u81ea A1 \u7684\u5185\u5fc3\u72ec\u767d。',
      '\u6765\u81ea A2 \u7684\u5185\u5fc3\u72ec\u767d。',
      '\u6765\u81ea B1 \u7684\u5185\u5fc3\u72ec\u767d。',
      '\u6765\u81ea B2 \u7684\u5185\u5fc3\u72ec\u767d。',
      '\u5b57\u5e55：\u6240\u6709\u7b11\u8bdd\u6700\u7ec8\u90fd\u4f1a\u91cd\u9022。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 3,
      structuralUnitIds: [],
      decisions: [
        { id: 'd0', ownerUnitId: 'u0', options: [
          { id: 'oa', sourceUnitId: 'u1', text: '\u80e1\u7f16\u4e71\u9020。' },
          { id: 'ob', sourceUnitId: 'u2', text: '\u786c\u521a\u5766\u767d。' },
        ] },
        { id: 'da', ownerUnitId: 'u3', options: [
          { id: 'oa1', sourceUnitId: 'u4', text: '\u5bf9\u8d28。' },
          { id: 'oa2', sourceUnitId: 'u6', text: '\u81ea\u9996。' },
        ] },
        { id: 'db', ownerUnitId: 'u8', options: [
          { id: 'ob1', sourceUnitId: 'u9', text: '\u6539\u9769。' },
          { id: 'ob2', sourceUnitId: 'u11', text: '\u9053\u6b49。' },
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
      const path = paths.find((candidate) => candidate.includes(`\u6765\u81ea ${marker} \u7684\u5185\u5fc3\u72ec\u767d`));
      expect(path).toContain('\u6240\u6709\u8def\u7ebf\u6765\u5230\u540c\u4e00\u573a\u9881\u5956\u5178\u793c');
      expect(path).not.toMatch(new RegExp(`\u6765\u81ea (?!${marker})[AB][12] \u7684\u5185\u5fc3\u72ec\u767d`));
    }
  });

  it('repairs explicit branch ownership with a source-targeted semantic patch', async () => {
    const source = [
      '\u6797\u6eaa：\u600e\u4e48\u5b89\u6170\u4ed6？',
      '\u9009\u62e9 A：\u6e29\u67d4\u503e\u542c。',
      '\u9009\u62e9 B：\u5b89\u9759\u966a\u4f34。',
      '\u5206\u652f A（\u6e29\u67d4\u503e\u542c）',
      '\u6797\u6eaa\u8010\u5fc3\u542c\u5b8c\u4e86\u6545\u4e8b。',
      '\u5206\u652f B（\u5b89\u9759\u966a\u4f34）',
      '\u6797\u6eaa\u5b89\u9759\u5730\u966a\u5728\u4e00\u65c1。',
      '\u4e24\u6761\u8def\u5f84\u6700\u7ec8\u90fd\u8d70\u5411\u548c\u89e3。',
    ].join('\n');
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify({
        version: 3,
        structuralUnitIds: ['u3', 'u5'],
        decisions: [{
          id: 'd0', ownerUnitId: 'u0', options: [
            { id: 'oa', sourceUnitId: 'u1', text: '\u6e29\u67d4\u503e\u542c。' },
            { id: 'ob', sourceUnitId: 'u2', text: '\u5b89\u9759\u966a\u4f34。' },
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

    expect(result.document.nodes.some((node) => node.content.includes('\u5b89\u9759\u5730\u966a\u5728\u4e00\u65c1')))
      .toBe(true);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure', 'submit_branch_patch',
    ]);
  });

  it('repairs repeated sibling leakage without falling back to Extractor or Graph Planner', async () => {
    const source = [
      '\u573a\u666f：\u5730\u94c1\u53e3。',
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u628a\u624b\u7f29\u4e86\u56de\u6765。',
    ].join('\n');
    const leaking = {
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'branch-stop:2', text: '\u9009\u62e9 A：\u4e70。', fromUnitId: 'branch-stop:1', targetUnitId: 'branch-stop:3' },
        { sourceUnitId: 'branch-stop:4', text: '\u9009\u62e9 B：\u4e0d\u4e70。', fromUnitId: 'branch-stop:1', targetUnitId: 'branch-stop:5' },
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
      '\u674e\u660e：\u4eca\u5929\u7559\u4e0b，\u8fd8\u662f\u73b0\u5728\u79bb\u5f00？',
      '\u53ef\u9009\u65b9\u6848\u4e00：\u7559\u4e0b。',
      '\u674e\u660e\u6536\u8d77\u8f66\u7968，\u7559\u5728\u5c4b\u91cc。',
      '\u53ef\u9009\u65b9\u6848\u4e8c：\u79bb\u5f00。',
      '\u674e\u660e\u62d6\u7740\u7bb1\u5b50\u8d70\u5411\u8f66\u7ad9。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'prose:1', text: '\u53ef\u9009\u65b9\u6848\u4e00：\u7559\u4e0b。', fromUnitId: 'prose:0', targetUnitId: 'prose:2' },
        { sourceUnitId: 'prose:3', text: '\u53ef\u9009\u65b9\u6848\u4e8c：\u79bb\u5f00。', fromUnitId: 'prose:0', targetUnitId: 'prose:4' },
      ],
      jumps: [],
      breakAfterUnitIds: ['prose:2', 'prose:4'],
    }));

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'prose',
      skipSemanticAuditAfterValidation: true,
    });

    expect(result.document.nodes.find((node) => node.options.length === 2)?.options
      .map((option) => option.text)).toEqual(['\u7559\u4e0b。', '\u79bb\u5f00。']);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_branch_structure',
    ]);
  });

  it('uses Branch Planner for long multi-unit branch stories before chunked extraction', async () => {
    const source = [
      `\u573a\u666f：${'\u957f\u591c'.repeat(5_100)}`,
      ...Array.from({ length: 19 }, (_, index) => `\u80cc\u666f\u6bb5\u843d ${index + 1}`),
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u628a\u624b\u7f29\u4e86\u56de\u6765。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'long-branch:21', text: '\u9009\u62e9 A：\u4e70。', fromUnitId: 'long-branch:20', targetUnitId: 'long-branch:22' },
        { sourceUnitId: 'long-branch:23', text: '\u9009\u62e9 B：\u4e0d\u4e70。', fromUnitId: 'long-branch:20', targetUnitId: 'long-branch:24' },
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
    const source = readEscapedScriptFixture('hierarchical-corridor-story');

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
      ['\u7406\u6027\u5224\u65ad', '\u76f4\u89c9\u5148\u884c'],
      ['\u89e6\u78b0\u9ed1\u955c', '\u7ed5\u884c\u9ed1\u955c'],
      ['\u4fe1\u4efb\u65e5\u8bb0，\u6309\u539f\u5e8f\u5f00\u95e8', '\u6000\u7591\u65e5\u8bb0，\u6309\u8865\u6ce8\u987a\u5e8f\u8c03\u6574'],
    ]));
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('imports wrapped act branches and their summary merge without LLM conversion calls', async () => {
    const source = readEscapedScriptFixture('hierarchical-career-story');

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'career-fast',
      skipSemanticAuditAfterValidation: true,
      enableHeuristicBranchParsing: true,
    });
    const decisions = result.document.nodes
      .filter((node) => node.options.length > 0)
      .map((node) => node.options.map((option) => option.text));
    const summary = result.document.nodes.find((node) => node.content.includes('\u6b8a\u9014\u540c\u5f52'));

    expect(decisions).toEqual(expect.arrayContaining([
      ['\u9009\u62e9\u5b8f\u56fe\u8d44\u672c，\u6311\u6218\u7ec8\u9762', '\u9009\u62e9\u542f\u822a\u54a8\u8be2，\u63a5\u53d7\u5f55\u7528'],
      ['\u63a5\u53d7“\u5feb\u901f\u664b\u5347”\u9879\u76ee', '\u9009\u62e9\u7a33\u5065\u7684“\u884c\u4e1a\u7814\u7a76”\u5c97\u4f4d'],
      ['\u575a\u6301\u4e13\u4e1a\u64cd\u5b88，\u62d2\u7edd“\u6ce8\u6c34”', '\u987a\u5e94\u516c\u53f8\u6587\u5316，\u5b66\u4f1a“\u5305\u88c5”'],
    ]));
    expect(result.document.nodes.filter((node) => node.next === summary?.label)).toHaveLength(4);
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('imports successive layered bookstore branches with a reachable final ending', async () => {
    const source = readEscapedScriptFixture('layered-bookstore-story');

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'bookstore-fast',
      skipSemanticAuditAfterValidation: true,
      enableHeuristicBranchParsing: true,
    });
    const decisions = result.document.nodes
      .filter((node) => node.options.length > 0)
      .map((node) => node.options.map((option) => option.text));

    expect(decisions).toEqual(expect.arrayContaining([
      ['\u6e29\u548c\u4e3b\u52a8\u95ee\u8be2', '\u5b89\u9759\u7559\u767d\u966a\u4f34'],
      ['\u7406\u6027\u5256\u6790\u5229\u5f0a', '\u5171\u60c5\u6cbb\u6108\u5b89\u629a'],
      ['\u53d6\u820d\u5f00\u5bfc', '\u843d\u5730\u529d\u89e3'],
      ['\u6e29\u67d4\u5171\u60c5\u5bbd\u6170', '\u6e29\u67d4\u515c\u5e95\u529d\u89e3'],
    ]));
    const visibleContent = result.document.nodes.map((node) => node.content);
    expect(visibleContent).not.toEqual(expect.arrayContaining([
      '\u4eba\u7269',
      expect.stringContaining('\u65e7\u4e66\u5e97\u5e97\u4e3b'),
      expect.stringContaining('\u5e94\u5c4a\u6bd5\u4e1a\u751f'),
      expect.stringContaining('\u7b2c\u4e00\u5c42\u7ea7\u53cc\u5e76\u884c\u5206\u652f'),
      expect.stringContaining('\u5e76\u884c\u5206\u652f\u7edf\u4e00\u6c47\u5165'),
      expect.stringContaining('\u7b2c\u4e8c\u5c42\u7ea7\u5d4c\u5957\u5206\u652f'),
      expect.stringContaining('\u6240\u6709\u5d4c\u5957\u5206\u652f\u7edf\u4e00\u6c47\u805a'),
    ]));
    expect(result.document.nodes.at(-1)?.content).toContain('\u5267\u7ec8');
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('imports hypothetical interview decisions without Extractor or duplicate source ownership', async () => {
    const source = readEscapedScriptFixture('scenario-interview-story');

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'interview-fast',
      skipSemanticAuditAfterValidation: true,
      enableHeuristicBranchParsing: true,
    });

    expect(result.converted).toBe(false);
    expect(result.document.nodes.filter((node) => node.options.length > 0).map((node) => (
      node.options.map((option) => option.text)
    ))).toEqual(expect.arrayContaining([
      ['\u6280\u672f\u6df1\u5ea6\u56de\u7b54', '\u6280\u672f\u74f6\u9888\u56de\u7b54'],
      ['\u8bda\u5b9e\u56de\u7b54', '\u5982\u679c\u674e\u660e\u8c0e\u79f0\u4e3b\u52a8\u8f9e\u804c'],
      ['\u575a\u6301\u5e95\u7ebf', '\u5982\u679c\u674e\u660e\u7acb\u523b\u59a5\u534f', '\u5982\u679c\u674e\u660e\u5f3a\u786c\u62d2\u7edd'],
    ]));
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('imports a lettered option menu as sibling branches without LLM conversion', async () => {
    const source = readEscapedScriptFixture('menu-branch-story');

    const result = await resolveStoryPlanForImport(source, {
      sourceId: 'menu-fast',
      skipSemanticAuditAfterValidation: true,
      enableHeuristicBranchParsing: true,
    });

    expect(result.converted).toBe(false);
    expect(result.document.nodes.filter((node) => node.options.length > 0).map((node) => (
      node.options.map((option) => option.text)
    ))).toContainEqual(['\u7acb\u523b\u524d\u5f80\u949f\u697c', '\u5148\u67e5\u9605\u66f4\u591a\u5386\u53f2\u6863\u6848', '\u8be2\u95ee\u9648\u6559\u6388\u66f4\u591a\u7ec6\u8282']);
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
      '【\u5f00\u573a】',
      '\u5973\u5e1d：\u4e09\u7b56\u5f53\u524d，\u537f\u62e9\u5176\u4e00。',
      '【\u5206\u652f\u9009\u62e9\u4e00：\u7b54\u5e03\u9632】',
      '\u4e1e\u76f8：\u81e3\u4ee5\u4e3a，\u5f53\u629a\u6c11\u4e3a\u5148。',
      '【\u5206\u652f\u4e00\u7ed3\u5c40：\u82f1\u96c4\u7684\u6c89\u9ed8】',
      '\u7fa4\u81e3\u9ed8\u7136。',
      '【\u5206\u652f\u9009\u62e9\u4e8c：\u56de\u5e94\u5973\u5e1d】',
      '\u4e1e\u76f8：\u81e3\u613f\u4e3a\u965b\u4e0b\u6267\u7b14。',
      '【\u5206\u652f\u4e8c\u7ed3\u5c40：\u58f0\u97f3\u7684\u4ee3\u4ef7】',
      '\u5973\u5e1d\u9894\u9996。',
      '【\u5206\u652f\u9009\u62e9\u4e09：\u56de\u5e94\u5927\u5c06\u519b】',
      '\u4e1e\u76f8：\u519b\u5fc3\u4e0d\u53ef\u8f7b\u52a8。',
      '【\u5206\u652f\u4e09\u7ed3\u5c40：\u65e0\u540d\u7684\u5fe0\u8bda】',
      '\u5927\u5c06\u519b\u62b1\u62f3。',
      '【\u6700\u7ec8\u5c3e\u58f0 - \u6240\u6709\u5206\u652f\u6c47\u805a】',
      '\u53f2\u5b98\u843d\u4e0b\u6700\u540e\u4e00\u7b14。',
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
            text: '\u7b54\u5e03\u9632',
            routeUnitIds: ['natural-bracketed:3', 'natural-bracketed:4', 'natural-bracketed:5'],
          },
          {
            sourceUnitId: 'natural-bracketed:6',
            text: '\u56de\u5e94\u5973\u5e1d',
            routeUnitIds: ['natural-bracketed:7', 'natural-bracketed:8', 'natural-bracketed:9'],
          },
          {
            sourceUnitId: 'natural-bracketed:10',
            text: '\u56de\u5e94\u5927\u5c06\u519b',
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
    expect(result.document.nodes.find((node) => node.content.includes('\u4e09\u7b56\u5f53\u524d'))?.options)
      .toHaveLength(3);
  });

  it('uses deterministic plot titles for both panes without a second Plot Planner call', async () => {
    const source = [
      '\u573a\u666f：\u5730\u94c1\u53e3。',
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u628a\u624b\u7f29\u4e86\u56de\u6765。',
      '\u4e00\u4e2a\u6708\u540e，\u963f\u57ce\u518d\u6b21\u6765\u5230\u5730\u94c1\u53e3。',
    ].join('\n');
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'unified:1',
        mergeUnitId: 'unified:6',
        options: [
          { sourceUnitId: 'unified:2', text: '\u9009\u62e9 A：\u4e70。', routeUnitIds: ['unified:3'] },
          { sourceUnitId: 'unified:4', text: '\u9009\u62e9 B：\u4e0d\u4e70。', routeUnitIds: ['unified:5'] },
        ],
      }],
      plotGroups: [
        { title: '\u5730\u94c1\u53e3\u7684\u9009\u62e9', sourceUnitIds: ['unified:0', 'unified:1'] },
        { title: '\u4e70\u82b1\u8def\u7ebf', sourceUnitIds: ['unified:3'] },
        { title: '\u653e\u5f03\u8def\u7ebf', sourceUnitIds: ['unified:5'] },
        { title: '\u4e00\u4e2a\u6708\u540e\u7684\u91cd\u9022', sourceUnitIds: ['unified:6'] },
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
      '\u5267\u60c5 1', '\u4e70。', '\u4e0d\u4e70。', '\u6700\u7ec8\u6c47\u805a',
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
