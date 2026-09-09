import { describe, expect, it, jest } from '@jest/globals';
import { reviewGddMarkdownV2 } from './generator';
import type { GddGenerationRequestV2 } from './contracts';

const input: GddGenerationRequestV2 = {
  contractVersion: 2,
  mode: 'professional',
  language: 'zh-CN',
  projectId: 'project-1',
  projectName: '\u96fe\u6e2f\u6f2b\u6e38',
  designSystemId: 'system-1',
  versionId: 'version-1',
  versionNumber: 1,
  systemTitle: 'Blueprint v1',
  rules: {
    schemaVersion: 1,
    genres: ['\u7ecf\u8425\u6a21\u62df'],
    philosophies: [],
    suitableFor: '\u73a9\u5bb6',
    rules: [],
    tableGuidance: [],
  },
  designDocument: {
    gameBackground: '\u96fe\u6e2f\u4e2d\u7684\u7ecf\u8425\u5192\u9669。',
    designIntent: '\u8ba9\u73a9\u5bb6\u7ba1\u7406\u6e2f\u53e3。',
    playerFantasy: '\u7ecf\u8425\u81ea\u5df1\u7684\u6e2f\u53e3。',
    coreLoop: '\u63a5\u5f85、\u7ecf\u8425、\u6269\u5efa。',
    decisionStructure: '\u5728\u9884\u7b97\u5185\u505a\u51fa\u9009\u62e9。',
    systemBoundaries: '\u5355\u673a。',
    progressionEconomy: '\u9010\u6b65\u6269\u5efa。',
    contentModel: '\u6e2f\u53e3\u548c\u89d2\u8272\u4e8b\u4ef6。',
    difficultyBalance: '\u9010\u6b65\u589e\u52a0\u538b\u529b。',
    experiencePresentation: '\u6e05\u6670\u53cd\u9988。',
  },
  projectSources: [],
};

const event = {
  chapterKey: 'harbor-arrival',
  title: '\u96fe\u6e2f\u521d\u9047',
  scene: '\u5e97\u4e3b\u5728\u7801\u5934\u8fce\u63a5\u65b0\u5ba2\u4eba\u5e76\u8ba8\u8bba\u4eca\u5929\u7684\u8d27\u7269。',
  participants: ['\u5e97\u4e3b', '\u5ba2\u4eba'],
  choices: ['\u63a5\u53d7\u8ba2\u5355', '\u62d2\u7edd\u8ba2\u5355'],
  consequences: '\u63a5\u53d7\u8ba2\u5355\u4f1a\u5f00\u542f\u4eca\u65e5\u4efb\u52a1。',
};

describe('professional GDD dialogue recovery', () => {
  it('plans Script content from a dialogue marker even without a narrative genre flag', async () => {
    const planScene = jest.fn(async (..._args: unknown[]) => ({
      chapterKey: event.chapterKey,
      title: event.title,
      content: '\u5e97\u4e3b：\u6b22\u8fce\u6765\u5230\u96fe\u6e2f。',
      hasChoices: true,
      branchSummary: event.choices,
    }));

    const result = await reviewGddMarkdownV2(
      input,
      `# \u96fe\u6e2f\u6f2b\u6e38\n\n## \u89d2\u8272\u4e8b\u4ef6\n\n${`<!-- KECO_DIALOGUE_SCENE ${JSON.stringify(event)} -->`}`,
      { complete: jest.fn(async () => '[]'), planScene },
    );

    expect(planScene).toHaveBeenCalledWith(
      expect.objectContaining({ event }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.dialoguePlans).toHaveLength(1);
    expect(result.markdown).not.toContain('KECO_DIALOGUE_SCENE');
  });
});
