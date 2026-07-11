import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));

import { completeLlm } from '@/lib/agent/llm-client';
import type { StoryExtraction } from '@/lib/story-extraction/schema';
import type { StoryPlanAudit } from './schema';
import { resolveStoryPlanForImport, type StoryPlanProgressEvent } from './conversion';
import { segmentStorySource } from './sourceSegments';

const mockedCompleteLlm = completeLlm as jest.MockedFunction<typeof completeLlm>;
const naturalContent = [
  '七号：我们必须选择一条路线。',
  '- 前往能源舱。选择时执行 $resolve+=1。',
  '你进入能源舱。',
].join('\n');
const passAudit: StoryPlanAudit = { verdict: 'pass', issues: [] };
const failAudit: StoryPlanAudit = {
  verdict: 'fail',
  issues: [{
    code: 'wrong_branch',
    severity: 'major',
    unitIds: ['fixture:1'],
    nodeIds: ['start'],
    message: 'Choice targets the wrong branch',
  }],
};

function naturalExtraction(): StoryExtraction {
  return {
    version: 3,
    entryNodeId: 'start',
    structuralUnitIds: [],
    nodes: [
      {
        id: 'start',
        type: 'dialogue',
        speaker: '七号',
        content: '我们必须选择一条路线。',
        sourceUnitIds: ['fixture:0'],
        commandSources: [],
        nextNodeId: '',
        choices: [{
          text: '前往能源舱。',
          targetNodeId: 'energy',
          sourceUnitIds: ['fixture:1'],
          commandSources: ['$resolve+=1'],
        }],
      },
      {
        id: 'energy',
        type: 'narration',
        speaker: '',
        content: '你进入能源舱。',
        sourceUnitIds: ['fixture:2'],
        commandSources: [],
        nextNodeId: '',
        choices: [],
      },
    ],
  };
}

function providerAbort(): Error {
  return Object.assign(new Error('LLM aborted before completing the response.'), {
    name: 'LlmError',
  });
}

describe('complete audited story extraction', () => {
  beforeEach(() => mockedCompleteLlm.mockReset());
  afterEach(() => jest.useRealTimers());

  it('creates choices from arbitrary prose even when deterministic choice inventory is empty', async () => {
    expect(segmentStorySource(naturalContent, 'fixture').segments
      .filter((segment) => segment.kind === 'choice_text')).toHaveLength(0);
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(naturalExtraction()))
      .mockResolvedValueOnce(JSON.stringify(passAudit));
    const progress: StoryPlanProgressEvent[] = [];

    const result = await resolveStoryPlanForImport(naturalContent, {
      sourceId: 'fixture',
      onProgress: (event) => progress.push(event),
    });

    expect(result.converted).toBe(true);
    expect(result.extraction.version).toBe(3);
    expect(result.document.nodes[0].options).toHaveLength(1);
    expect(mockedCompleteLlm.mock.calls.map((call) => call[1].toolName)).toEqual([
      'submit_complete_story_ir',
      'submit_story_plan_audit',
    ]);
    expect(progress.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'conversion', 'deterministic_validation', 'table_projection', 'semantic_audit', 'complete',
    ]));
  });

  it('routes explicit old-format text through the same Converter and Auditor', async () => {
    const content = '【Start｜Opening】\n（Type1・Guide）Begin.';
    const extraction: StoryExtraction = {
      version: 3,
      entryNodeId: 'Start',
      structuralUnitIds: [],
      nodes: [
        { id: 'Start', type: 'scene', speaker: '', content: 'Opening', sourceUnitIds: ['fixture:0'], commandSources: [], nextNodeId: 'line', choices: [] },
        { id: 'line', type: 'dialogue', speaker: 'Guide', content: 'Begin.', sourceUnitIds: ['fixture:1'], commandSources: [], nextNodeId: '', choices: [] },
      ],
    };
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(extraction))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(content, { sourceId: 'fixture' });

    expect(result.converted).toBe(true);
    expect(result.document.entryLabel).toBe('Start');
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(2);
  });

  it('repairs an Auditor failure with a fresh Converter and Auditor round', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(naturalExtraction()))
      .mockResolvedValueOnce(JSON.stringify(failAudit))
      .mockResolvedValueOnce(JSON.stringify(naturalExtraction()))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });

    expect(result.attempts).toBe(2);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(4);
    expect(mockedCompleteLlm.mock.calls[2][0][1].content).toContain('wrong_branch');
  });

  it('feeds deterministic extraction issues into the repair attempt', async () => {
    const invalid = naturalExtraction();
    invalid.nodes[0].choices[0].commandSources = ['$resolve+=9'];
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(invalid))
      .mockResolvedValueOnce(JSON.stringify(naturalExtraction()))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });

    expect(result.attempts).toBe(2);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(3);
    expect(mockedCompleteLlm.mock.calls[1][0][1].content).toContain('unknown_command');
  });

  it('strictly rejects wrapper output and retries', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify({ item: naturalExtraction() }))
      .mockResolvedValueOnce(JSON.stringify(naturalExtraction()))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });
    expect(result.attempts).toBe(2);
  });

  it('retries a provider-aborted response without consuming an attempt', async () => {
    mockedCompleteLlm
      .mockRejectedValueOnce(providerAbort())
      .mockResolvedValueOnce(JSON.stringify(naturalExtraction()))
      .mockResolvedValueOnce(JSON.stringify(passAudit));

    const result = await resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' });
    expect(result.attempts).toBe(1);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(3);
  });

  it('fails closed after two rejected audited candidates', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify(naturalExtraction()))
      .mockResolvedValueOnce(JSON.stringify(failAudit))
      .mockResolvedValueOnce(JSON.stringify(naturalExtraction()))
      .mockResolvedValueOnce(JSON.stringify(failAudit));

    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toThrow(/two audited attempts/i);
  });

  it('caps repeated provider aborts at four total calls', async () => {
    mockedCompleteLlm.mockRejectedValue(providerAbort());
    await expect(resolveStoryPlanForImport(naturalContent, { sourceId: 'fixture' }))
      .rejects.toThrow(/two audited attempts/i);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(4);
  });

  it('rejects oversized or cancelled input before conversion', async () => {
    await expect(resolveStoryPlanForImport('Too long', { sourceId: 'fixture', maxSourceChars: 4 }))
      .rejects.toThrow(/too long/i);
    const controller = new AbortController();
    controller.abort();
    await expect(resolveStoryPlanForImport(naturalContent, { signal: controller.signal }))
      .rejects.toThrow(/aborted/i);
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('aborts a timed-out Converter', async () => {
    jest.useFakeTimers();
    mockedCompleteLlm.mockImplementation(async (_messages, options) =>
      await new Promise<string>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      })
    );
    const conversion = resolveStoryPlanForImport(naturalContent, {
      sourceId: 'fixture',
      llmTimeoutMs: 25,
    });
    const rejection = expect(conversion).rejects.toThrow(/timed out.*Converter/i);
    await jest.advanceTimersByTimeAsync(26);
    await rejection;
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(1);
  });
});
