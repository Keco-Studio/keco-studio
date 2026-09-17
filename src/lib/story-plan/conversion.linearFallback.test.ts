import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({
  completeLlm: jest.fn(),
}));

import { completeLlm } from '@/lib/agent/llm-client';
import { ImportStoryPlanError, resolveStoryPlanForImport } from './conversion';

const malformedRepeatedBranches = [
  '【海岸线】',
  '守夜人：东边的光还亮着。',
  '【分支选择一：询问灯塔】',
  '守夜人：灯塔总在最东边。',
  '【分支选择二：询问底座】',
  '守夜人：缺角朝着内陆。',
  '【渔村】',
  '渔夫：码头曾经伸向深水。',
  '【分支选择一：询问旧路】',
  '渔夫：退潮时还能看见石阶。',
  '【分支选择二：询问渔网】',
  '渔夫：网都挂在村子的西边。',
].join('\n\n');

describe('GDD dialogue linear fallback', () => {
  it('preserves visible dialogue when branch planning exhausts its retries', async () => {
    jest.mocked(completeLlm).mockResolvedValue('{}');

    const resolved = await resolveStoryPlanForImport(malformedRepeatedBranches, {
      sourceId: 'gdd-dialogue-document',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: true,
      fallbackToLinearOnBranchFailure: true,
    });

    expect(completeLlm).toHaveBeenCalledTimes(2);
    expect(resolved.approval).toBe('validation_pass');
    expect(resolved.document.nodes).not.toHaveLength(0);
    expect(resolved.document.nodes.every((node) => node.options.length === 0)).toBe(true);
    const visible = resolved.document.nodes
      .flatMap((node) => [node.speaker ?? '', node.content])
      .join('\n');
    expect(visible).toContain('询问灯塔');
    expect(visible).toContain('灯塔总在最东边。');
    expect(visible).toContain('询问旧路');
    expect(visible).toContain('退潮时还能看见石阶。');
  });

  it('keeps normal imports strict when the GDD-only fallback is disabled', async () => {
    jest.mocked(completeLlm).mockResolvedValue('{}');

    await expect(resolveStoryPlanForImport(malformedRepeatedBranches, {
      sourceId: 'manual-import',
      skipSemanticAuditAfterValidation: true,
      enableAiPlotPlanning: true,
    })).rejects.toBeInstanceOf(ImportStoryPlanError);
  });
});
