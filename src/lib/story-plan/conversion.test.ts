import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));

import { completeLlm } from '@/lib/agent/llm-client';
import type {
  StoryGraphPlan,
  StoryPlanAudit,
  StoryRelationshipPlan,
} from './schema';
import { segmentStorySource } from './sourceSegments';
import {
  resolveStoryPlanForImport,
  type StoryPlanProgressEvent,
} from './conversion';

const mockedCompleteLlm = completeLlm as jest.MockedFunction<typeof completeLlm>;
const explicitFixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);
const passAudit: StoryPlanAudit = { verdict: 'pass', issues: [] };
const failAudit: StoryPlanAudit = {
  verdict: 'fail',
  issues: [{
    code: 'wrong_branch',
    severity: 'major',
    unitIds: ['fixture:0'],
    nodeIds: ['n1'],
    message: 'Choice targets the wrong branch',
  }],
};

function providerAbort(): Error {
  return Object.assign(new Error('LLM aborted before completing the response.'), {
    name: 'LlmError',
  });
}

function naturalPlan(content: string): StoryRelationshipPlan {
  const source = segmentStorySource(content, 'fixture');
  const segment = source.segments.find((candidate) => candidate.kind === 'narration')!;
  return {
    version: 2,
    entryNodeId: 'Node1',
    nodes: [{
      id: 'Node1',
      type: 'narration',
      speakerSegmentId: '',
      contentSegmentIds: [segment.id],
      commandIds: [],
      nextNodeId: '',
    }],
    choices: [],
  };
}

function naturalGraph(content: string): StoryGraphPlan {
  const plan = naturalPlan(content);
  return {
    version: 2,
    entryNodeId: plan.entryNodeId,
    breakAfterNodeIds: [],
    nextOverrides: [],
    choiceEdges: plan.choices.map((choice) => ({
      choiceId: choice.id,
      fromNodeId: choice.fromNodeId,
      targetNodeId: choice.targetNodeId,
    })),
  };
}

describe('audited story plan conversion', () => {
  beforeEach(() => mockedCompleteLlm.mockReset());
  afterEach(() => jest.useRealTimers());

  it('audits an explicit deterministic candidate without a Converter call', async () => {
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(explicitFixture, { sourceId: 'fixture' });

    expect(result.converted).toBe(false);
    expect(result.audit.verdict).toBe('pass');
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(1);
    expect(mockedCompleteLlm.mock.calls[0][1].toolName).toBe('submit_story_plan_audit');
  });

  it('converts natural input and then requires an Auditor pass', async () => {
    const content = 'Rain fell over the empty manor.';
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(naturalGraph(content)))
      .mockResolvedValueOnce(JSON.stringify(passAudit));
    const progress: StoryPlanProgressEvent[] = [];

    const result = await resolveStoryPlanForImport(content, {
      sourceId: 'fixture',
      onProgress: (event) => progress.push(event),
    });

    expect(result.converted).toBe(true);
    expect(result.attempts).toBe(1);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_relationship_plan',
      'submit_story_plan_audit',
    ]);
    expect(progress.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'source_segmentation',
      'conversion',
      'deterministic_validation',
      'table_projection',
      'semantic_audit',
      'complete',
    ]));
  });

  it('repairs an audit failure with one fresh Converter and Auditor round', async () => {
    const content = 'Rain fell over the empty manor.';
    const graph = naturalGraph(content);
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(graph))
      .mockResolvedValueOnce(JSON.stringify(failAudit))
      .mockResolvedValueOnce(JSON.stringify(graph))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(content, { sourceId: 'fixture' });

    expect(result.attempts).toBe(2);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_story_relationship_plan',
      'submit_story_plan_audit',
      'submit_story_relationship_plan',
      'submit_story_plan_audit',
    ]);
  });

  it('fails closed after two rejected audited candidates', async () => {
    const content = 'Rain fell over the empty manor.';
    const graph = naturalGraph(content);
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(graph))
      .mockResolvedValueOnce(JSON.stringify(failAudit))
      .mockResolvedValueOnce(JSON.stringify(graph))
      .mockResolvedValueOnce(JSON.stringify(failAudit));

    await expect(resolveStoryPlanForImport(content, { sourceId: 'fixture' }))
      .rejects.toThrow(/two audited attempts/i);
  });

  it('feeds deterministic graph validation issues into the one repair attempt', async () => {
    const content = 'Rain fell over the empty manor.';
    const valid = naturalGraph(content);
    const invalid = {
      ...valid,
      nextOverrides: [{ nodeId: 'Node1', targetNodeId: 'Node1' }],
    };
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(invalid))
      .mockResolvedValueOnce(JSON.stringify(valid))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(content, { sourceId: 'fixture' });

    expect(result.attempts).toBe(2);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(3);
    const secondConverterInput = mockedCompleteLlm.mock.calls[1][0][1].content;
    expect(secondConverterInput).toContain('automatic_cycle');
  });

  it('strictly rejects provider wrapper shapes and retries without normalizing them', async () => {
    const content = 'Rain fell over the empty manor.';
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify({ item: naturalGraph(content), next: null }))
      .mockResolvedValueOnce(JSON.stringify(naturalGraph(content)))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(content, { sourceId: 'fixture' });

    expect(result.attempts).toBe(2);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(3);
  });

  it('retries a provider-aborted response without consuming a candidate attempt', async () => {
    const content = 'Rain fell over the empty manor.';
    mockedCompleteLlm
      .mockRejectedValueOnce(providerAbort())
      .mockResolvedValueOnce(JSON.stringify(naturalGraph(content)))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(content, { sourceId: 'fixture' });

    expect(result.attempts).toBe(1);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(3);
  });

  it('caps repeated provider aborts at four total LLM calls', async () => {
    mockedCompleteLlm.mockRejectedValue(providerAbort());

    await expect(resolveStoryPlanForImport('Rain fell.', { sourceId: 'fixture' }))
      .rejects.toThrow(/two audited attempts/i);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(4);
  });

  it('rejects oversized input before any LLM request', async () => {
    await expect(resolveStoryPlanForImport('Too long', {
      sourceId: 'fixture',
      maxSourceChars: 4,
    })).rejects.toThrow(/too long/i);
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('honors cancellation before the first model request', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(resolveStoryPlanForImport('Rain fell.', {
      sourceId: 'fixture',
      signal: controller.signal,
    })).rejects.toThrow(/aborted/i);
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('aborts a timed-out Converter without consuming a repair attempt', async () => {
    jest.useFakeTimers();
    mockedCompleteLlm.mockImplementation(async (_messages, options) =>
      await new Promise<string>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      })
    );

    const conversion = resolveStoryPlanForImport('Rain fell.', {
      sourceId: 'fixture',
      llmTimeoutMs: 25,
    });
    const rejection = expect(conversion).rejects.toThrow(/timed out.*Converter/i);
    await jest.advanceTimersByTimeAsync(26);

    await rejection;
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(1);
  });
});
