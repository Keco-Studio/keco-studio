import { describe, expect, it } from '@jest/globals';
import { inferGddOutputLanguage, isGddGenerationRequestV2, reviewSchema } from './contracts';

describe('GDD v2 job contract', () => {
  it('recognizes queued v2 generation requests', () => {
    expect(isGddGenerationRequestV2({ contractVersion: 2, mode: 'professional', projectId: 'project-1', versionId: 'version-1' })).toBe(true);
    expect(isGddGenerationRequestV2({ contractVersion: 1, mode: 'quick', projectId: 'project-1', versionId: 'version-1' })).toBe(false);
    expect(isGddGenerationRequestV2({ contractVersion: 2, mode: 'invalid', projectId: 'project-1', versionId: 'version-1' })).toBe(false);
  });

  it('validates the review metadata returned by the direct Markdown path', () => {
    expect(reviewSchema.parse({
      version: 2,
      summary: 'Completed.',
      status: 'pass',
      repairRound: 0,
      issues: [],
    })).toEqual(expect.objectContaining({ version: 2, status: 'pass' }));
  });

  it('infers the dominant input language for generated output', () => {
    expect(inferGddOutputLanguage(['Land of Echoes', 'Observe, decide, act.'])).toBe('en-US');
    expect(inferGddOutputLanguage(['冒险闯关背景', '观察土地状态并选择行动。'])).toBe('zh-CN');
  });

  it('prefers the language of the substantive brief over unrelated project metadata', () => {
    expect(inferGddOutputLanguage([
      '中文项目名称',
      '中文设计系统标题',
      'Build an English adventure game with readable combat decisions.',
      '{"description":"中文规则说明，玩家需要探索地图、收集资源、解锁技能，并在战斗中做出有意义的决策。中文规则说明，玩家需要探索地图、收集资源、解锁技能。"}',
    ])).toBe('en-US');
  });

  it('keeps a short Chinese user brief from being overridden by English system metadata', () => {
    expect(inferGddOutputLanguage(['请生成冒险闯关游戏 GDD'])).toBe('zh-CN');
  });
});
