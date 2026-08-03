import { describe, expect, it } from '@jest/globals';
import { segmentStorySource } from './sourceSegments';
import { chunkStorySource } from './chunkedSource';

describe('chunked story source', () => {
  it('preserves exact source units and prefers story boundaries', () => {
    const source = segmentStorySource([
      '\u573a\u666f\u4e00',
      '\u6797\u9ed8：\u529e\u516c\u5ba4\u91cc\u7684\u65e5\u8bb0。',
      '\u82cf\u665a：\u6211\u4eec\u5fc5\u987b\u518d\u53bb\u4e00\u6b21。',
      '\u5206\u652f\u70b9 A：\u7406\u6027\u5224\u65ad',
      '\u6797\u9ed8：\u5148\u505a\u52d8\u6d4b。',
      '→ \u7ed3\u5c40\u4e00：\u9519\u5931\u4e4b\u95e8',
      '\u5206\u652f\u70b9 B：\u76f4\u89c9\u5148\u884c',
      '\u6797\u9ed8：\u73b0\u5728\u51fa\u53d1。',
      '\u5206\u652f\u70b9 A1：\u89e6\u78b0\u9ed1\u955c',
      '→ \u7ed3\u5c40\u4e8c：\u6c38\u6052\u6d41\u653e',
    ].join('\n'), 'fixture');

    const chunks = chunkStorySource(source, 50);
    const originalIds = source.units.map((unit) => unit.id);
    const chunkIds = chunks.flatMap((chunk) => chunk.units.map((unit) => unit.id));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunkIds).toEqual(originalIds);
    expect(chunks.every((chunk) => chunk.segments.every((segment) => (
      chunk.units.some((unit) => unit.id === segment.unitId)
    )))).toBe(true);
    expect(chunks.slice(1).every((chunk) => /^(?:\u573a\u666f|\u5206\u652f\u70b9|\u5206\u652f|→|\*→)/.test(chunk.units[0].text))).toBe(true);
  });

  it('keeps a very long indivisible unit intact', () => {
    const source = segmentStorySource(`\u573a\u666f\u4e00\n${'\u957f\u6bb5\u843d'.repeat(100)}`, 'fixture');
    const chunks = chunkStorySource(source, 20);

    expect(chunks.flatMap((chunk) => chunk.units.map((unit) => unit.text)))
      .toEqual(source.units.map((unit) => unit.text));
    expect(chunks).toHaveLength(1);
  });
});
