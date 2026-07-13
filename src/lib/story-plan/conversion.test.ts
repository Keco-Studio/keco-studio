import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));

import { completeLlm } from '@/lib/agent/llm-client';
import type { StoryContentExtraction, StoryGraphExtraction } from '@/lib/story-extraction/pipeline';
import type { StoryAuditAdjudication, StoryPlanAudit } from './schema';
import {
  STORY_PLAN_LLM_TIMEOUT_MS,
  resolveStoryPlanForImport,
  type StoryPlanProgressEvent,
} from './conversion';
import { segmentStorySource } from './sourceSegments';

const mockedCompleteLlm = completeLlm as jest.MockedFunction<typeof completeLlm>;
const naturalContent = [
  '七号：我们必须选择一条路线。',
  '- 前往能源舱。选择时执行 $resolve+=1。',
  '你进入能源舱。',
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
      { id: 'start', type: 'dialogue', presentationType: 1, speaker: '七号', content: '我们必须选择一条路线。', sourceUnitIds: ['fixture:0'] },
      { id: 'energy', type: 'narration', presentationType: 3, speaker: '', content: '你进入能源舱。', sourceUnitIds: ['fixture:2'] },
    ],
    choices: [
      { id: 'go_energy', text: '前往能源舱。', sourceUnitIds: ['fixture:1'] },
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
    const source = '人物：你（守灯人）、海客少年\n少年：灯还亮着。\n你：我知道。';
    const content: StoryContentExtraction = {
      version: 3,
      structuralUnitIds: ['roles:0'],
      nodes: [
        { id: 'boy', type: 'dialogue', presentationType: 1, speaker: '少年', content: '灯还亮着。', sourceUnitIds: ['roles:1'] },
        { id: 'you', type: 'dialogue', presentationType: 2, speaker: '你', content: '我知道。', sourceUnitIds: ['roles:2'] },
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
      .toEqual([['少年', 2], ['你', 1]]);
    expect(result.document.nodes.map((node) => [node.speaker, node.presentationType]))
      .toEqual([['少年', 2], ['你', 1]]);
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
      .rejects.toThrow(/three audited attempts/i);
  });

  it('caps provider abort retries per stage so later candidate attempts retain budget', async () => {
    mockedCompleteLlm.mockRejectedValue(providerAbort());
    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toThrow(/three audited attempts/i);
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
