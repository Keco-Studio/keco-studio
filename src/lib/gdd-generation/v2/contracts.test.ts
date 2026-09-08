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
    expect(inferGddOutputLanguage([
      '\u5192\u9669\u95ef\u5173\u80cc\u666f',
      '\u89c2\u5bdf\u571f\u5730\u72b6\u6001\u5e76\u9009\u62e9\u884c\u52a8。',
    ])).toBe('zh-CN');
  });

  it('prefers the language of the substantive brief over unrelated project metadata', () => {
    expect(inferGddOutputLanguage([
      '\u4e2d\u6587\u9879\u76ee\u540d\u79f0',
      '\u4e2d\u6587\u8bbe\u8ba1\u7cfb\u7edf\u6807\u9898',
      'Build an English adventure game with readable combat decisions.',
      '{"description":"\u4e2d\u6587\u89c4\u5219\u8bf4\u660e，\u73a9\u5bb6\u9700\u8981\u63a2\u7d22\u5730\u56fe、\u6536\u96c6\u8d44\u6e90、\u89e3\u9501\u6280\u80fd，\u5e76\u5728\u6218\u6597\u4e2d\u505a\u51fa\u6709\u610f\u4e49\u7684\u51b3\u7b56。\u4e2d\u6587\u89c4\u5219\u8bf4\u660e，\u73a9\u5bb6\u9700\u8981\u63a2\u7d22\u5730\u56fe、\u6536\u96c6\u8d44\u6e90、\u89e3\u9501\u6280\u80fd。"}',
    ])).toBe('en-US');
  });

  it('keeps a short Chinese user brief from being overridden by English system metadata', () => {
    expect(inferGddOutputLanguage(['\u8bf7\u751f\u6210\u5192\u9669\u95ef\u5173\u6e38\u620f GDD'])).toBe('zh-CN');
  });
});
