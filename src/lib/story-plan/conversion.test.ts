import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));

import { completeLlm } from '@/lib/agent/llm-client';
import type { StoryContentExtraction, StoryGraphExtraction } from '@/lib/story-extraction/pipeline';
import type { StoryPlanAudit } from './schema';
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
const passAudit: StoryPlanAudit = { verdict: 'pass', issues: [] };
const naturalCommandId = segmentStorySource(naturalContent, 'fixture').commands[0].id;
const failAudit: StoryPlanAudit = {
  verdict: 'fail',
  issues: [{ code: 'wrong_branch', severity: 'major', unitIds: ['fixture:1'], nodeIds: ['start'], message: 'Choice targets the wrong branch' }],
};

function contentInventory(): StoryContentExtraction {
  return {
    version: 3,
    structuralUnitIds: [],
    nodes: [
      { id: 'start', type: 'dialogue', speaker: '七号', content: '我们必须选择一条路线。', sourceUnitIds: ['fixture:0'] },
      { id: 'energy', type: 'narration', speaker: '', content: '你进入能源舱。', sourceUnitIds: ['fixture:2'] },
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
    expect(auditorInput.extraction.structuralUnitIds).toEqual([]);
  });

  it('repairs an Auditor failure with a fresh Extractor and Graph Planner round', async () => {
    queueSuccess(failAudit);
    queueSuccess(passAudit);

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });
    expect(result.attempts).toBe(2);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(6);
    expect(mockedCompleteLlm.mock.calls[3][0][1].content).toContain('wrong_branch');
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      mockedCompleteLlm
        .mockResolvedValueOnce(JSON.stringify(contentInventory()))
        .mockResolvedValueOnce(JSON.stringify({ nodeLinks: 'invalid' }));
    }
    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toMatchObject({
        issues: [expect.objectContaining({ message: expect.stringContaining('Graph Planner') })],
      });
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
    queueSuccess(failAudit);
    queueSuccess(failAudit);
    queueSuccess(failAudit);
    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toThrow(/three audited attempts/i);
  });

  it('caps repeated provider aborts after six transport retries beyond nine stage calls', async () => {
    mockedCompleteLlm.mockRejectedValue(providerAbort());
    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toThrow(/three audited attempts/i);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(15);
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
