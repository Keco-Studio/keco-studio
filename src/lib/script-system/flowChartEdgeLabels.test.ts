import { describe, expect, it } from '@jest/globals';
import {
  placeEdgeLabels,
  wrapEdgeLabel,
} from './flowChartEdgeLabels';

describe('wrapEdgeLabel', () => {
  it('keeps short text on one line', () => {
    expect(wrapEdgeLabel('\u7b54\u5e03\u9632')).toEqual(['\u7b54\u5e03\u9632']);
  });

  it('wraps long text onto multiple lines of at most 8 characters', () => {
    const lines = wrapEdgeLabel(
      '\u8fd9\u662f\u4e00\u6bb5\u5f88\u957f\u7684\u5206\u652f\u9009\u9879\u6587\u6848\u5185\u5bb9'
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(
      '\u8fd9\u662f\u4e00\u6bb5\u5f88\u957f\u7684\u5206\u652f\u9009\u9879\u6587\u6848\u5185\u5bb9'
    );
    expect(lines.every((line) => Array.from(line).length <= 8)).toBe(true);
  });

  it('truncates with ellipsis after the max line count', () => {
    const lines = wrapEdgeLabel(
      '\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341ABCDEFGH',
      8,
      3
    );
    expect(lines).toHaveLength(3);
    expect(lines[2]?.endsWith('\u2026')).toBe(true);
  });
});

describe('placeEdgeLabels', () => {
  it('keeps labels that already have space at their anchors', () => {
    const placed = placeEdgeLabels([
      { id: 'a', text: '\u5de6\u5206\u652f', x: 100, y: 80 },
      { id: 'b', text: '\u53f3\u5206\u652f', x: 320, y: 80 },
    ]);
    expect(placed[0]?.x).toBe(100);
    expect(placed[1]?.x).toBe(320);
    expect(placed[0]?.y).toBe(80);
    expect(placed[1]?.y).toBe(80);
  });

  it('nudges overlapping labels so their boxes no longer collide', () => {
    const placed = placeEdgeLabels([
      { id: 'a', text: '\u9009\u62e9\u5b89\u629a\u5973\u5e1d\u5e76\u7a33\u4f4f\u671d\u5802', x: 200, y: 100 },
      { id: 'b', text: '\u9009\u62e9\u5f3a\u786c\u56de\u51fb\u5e76\u53d1\u52a8\u653f\u53d8', x: 200, y: 100 },
      { id: 'c', text: '\u9009\u62e9\u6c89\u9ed8\u65c1\u89c2\u7b49\u5f85\u65f6\u673a', x: 200, y: 100 },
    ]);

    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        const overlapX =
          a.x - a.width / 2 < b.x + b.width / 2 &&
          a.x + a.width / 2 > b.x - b.width / 2;
        const overlapY =
          a.y - a.height / 2 < b.y + b.height / 2 &&
          a.y + a.height / 2 > b.y - b.height / 2;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });
});
