import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));

import { completeLlm } from '@/lib/agent/llm-client';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';

const mockedCompleteLlm = completeLlm as jest.MockedFunction<typeof completeLlm>;

describe('script conversion service facade', () => {
  beforeEach(() => mockedCompleteLlm.mockReset());

  it('returns validated Story IR for canonical scripts', async () => {
    const source = '【Start｜Opening】\n（Type1・Guide）Begin.';
    mockedCompleteLlm
      .mockResolvedValueOnce(JSON.stringify({
        version: 3,
        structuralUnitIds: [],
        choices: [],
        nodes: [
          { id: 'Start', type: 'scene', presentationType: 4, speaker: '', content: 'Opening', sourceUnitIds: ['import:0'] },
          { id: 'line', type: 'dialogue', presentationType: 1, speaker: 'Guide', content: 'Begin.', sourceUnitIds: ['import:1'] },
        ],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        version: 3,
        entryNodeId: 'Start',
        nodeLinks: ['Start->line', 'line->'],
        choiceLinks: [],
        commandLinks: [],
      }))
      .mockResolvedValueOnce(JSON.stringify({ verdict: 'pass', issues: [] }));
    const result = await resolveStoryForImport(source);

    expect(result).toMatchObject({
      converted: true,
      document: { version: 1, entryLabel: 'Start' },
      audit: { verdict: 'pass', issues: [] },
      extraction: { version: 3, entryNodeId: 'Start' },
    });
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(3);
    expect(mockedCompleteLlm.mock.calls[0][1].toolName).toBe('submit_story_content_inventory');
    expect(mockedCompleteLlm.mock.calls[1][1].toolName).toBe('submit_story_graph');
    expect(mockedCompleteLlm.mock.calls[2][1].toolName).toBe('submit_story_plan_audit');
  });

  it('rejects empty source before model conversion', async () => {
    await expect(resolveStoryForImport('   ')).rejects.toThrow(/content/i);
  });
});
