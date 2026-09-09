import { describe, expect, it, jest } from '@jest/globals';
import { reviewGddMarkdownV2 } from './generator';
import type { GddGenerationRequestV2 } from './contracts';

const input: GddGenerationRequestV2 = {
  contractVersion: 2,
  mode: 'professional',
  language: 'zh-CN',
  projectId: 'project-1',
  projectName: '雾港漫游',
  designSystemId: 'system-1',
  versionId: 'version-1',
  versionNumber: 1,
  systemTitle: 'Blueprint v1',
  rules: {
    schemaVersion: 1,
    genres: ['经营模拟'],
    philosophies: [],
    suitableFor: '玩家',
    rules: [],
    tableGuidance: [],
  },
  designDocument: {
    gameBackground: '雾港中的经营冒险。',
    designIntent: '让玩家管理港口。',
    playerFantasy: '经营自己的港口。',
    coreLoop: '接待、经营、扩建。',
    decisionStructure: '在预算内做出选择。',
    systemBoundaries: '单机。',
    progressionEconomy: '逐步扩建。',
    contentModel: '港口和角色事件。',
    difficultyBalance: '逐步增加压力。',
    experiencePresentation: '清晰反馈。',
  },
  projectSources: [],
};

const event = {
  chapterKey: 'harbor-arrival',
  title: '雾港初遇',
  scene: '店主在码头迎接新客人并讨论今天的货物。',
  participants: ['店主', '客人'],
  choices: ['接受订单', '拒绝订单'],
  consequences: '接受订单会开启今日任务。',
};

describe('professional GDD dialogue recovery', () => {
  it('plans Script content from a dialogue marker even without a narrative genre flag', async () => {
    const planScene = jest.fn(async (..._args: unknown[]) => ({
      chapterKey: event.chapterKey,
      title: event.title,
      content: '店主：欢迎来到雾港。',
      hasChoices: true,
      branchSummary: event.choices,
    }));

    const result = await reviewGddMarkdownV2(
      input,
      `# 雾港漫游\n\n## 角色事件\n\n${`<!-- KECO_DIALOGUE_SCENE ${JSON.stringify(event)} -->`}`,
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
