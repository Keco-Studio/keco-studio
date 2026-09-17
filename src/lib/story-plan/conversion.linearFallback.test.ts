import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({
  completeLlm: jest.fn(),
}));

import { completeLlm } from '@/lib/agent/llm-client';
import { ImportStoryPlanError, resolveStoryPlanForImport } from './conversion';

const malformedRepeatedBranches = [
  '【\u6d77\u5cb8\u7ebf】',
  '\u5b88\u591c\u4eba：\u4e1c\u8fb9\u7684\u5149\u8fd8\u4eae\u7740。',
  '【\u5206\u652f\u9009\u62e9\u4e00：\u8be2\u95ee\u706f\u5854】',
  '\u5b88\u591c\u4eba：\u706f\u5854\u603b\u5728\u6700\u4e1c\u8fb9。',
  '【\u5206\u652f\u9009\u62e9\u4e8c：\u8be2\u95ee\u5e95\u5ea7】',
  '\u5b88\u591c\u4eba：\u7f3a\u89d2\u671d\u7740\u5185\u9646。',
  '【\u6e14\u6751】',
  '\u6e14\u592b：\u7801\u5934\u66fe\u7ecf\u4f38\u5411\u6df1\u6c34。',
  '【\u5206\u652f\u9009\u62e9\u4e00：\u8be2\u95ee\u65e7\u8def】',
  '\u6e14\u592b：\u9000\u6f6e\u65f6\u8fd8\u80fd\u770b\u89c1\u77f3\u9636。',
  '【\u5206\u652f\u9009\u62e9\u4e8c：\u8be2\u95ee\u6e14\u7f51】',
  '\u6e14\u592b：\u7f51\u90fd\u6302\u5728\u6751\u5b50\u7684\u897f\u8fb9。',
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
    expect(visible).toContain('\u8be2\u95ee\u706f\u5854');
    expect(visible).toContain('\u706f\u5854\u603b\u5728\u6700\u4e1c\u8fb9。');
    expect(visible).toContain('\u8be2\u95ee\u65e7\u8def');
    expect(visible).toContain('\u9000\u6f6e\u65f6\u8fd8\u80fd\u770b\u89c1\u77f3\u9636。');
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
