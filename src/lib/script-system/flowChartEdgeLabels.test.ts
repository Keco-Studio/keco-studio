import { describe, expect, it } from '@jest/globals';
import {
  placeEdgeLabels,
  wrapEdgeLabel,
} from './flowChartEdgeLabels';

describe('wrapEdgeLabel', () => {
  it('keeps short text on one line', () => {
    expect(wrapEdgeLabel('答布防')).toEqual(['答布防']);
  });

  it('wraps long text onto multiple lines of at most 8 characters', () => {
    const lines = wrapEdgeLabel('这是一段很长的分支选项文案内容');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('这是一段很长的分支选项文案内容');
    expect(lines.every((line) => Array.from(line).length <= 8)).toBe(true);
  });

  it('truncates with ellipsis after the max line count', () => {
    const lines = wrapEdgeLabel('一二三四五六七八九十一二三四五六七八九十ABCDEFGH', 8, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]?.endsWith('…')).toBe(true);
  });
});

describe('placeEdgeLabels', () => {
  it('keeps labels that already have space at their anchors', () => {
    const placed = placeEdgeLabels([
      { id: 'a', text: '左分支', x: 100, y: 80 },
      { id: 'b', text: '右分支', x: 320, y: 80 },
    ]);
    expect(placed[0]?.x).toBe(100);
    expect(placed[1]?.x).toBe(320);
    expect(placed[0]?.y).toBe(80);
    expect(placed[1]?.y).toBe(80);
  });

  it('nudges overlapping labels so their boxes no longer collide', () => {
    const placed = placeEdgeLabels([
      { id: 'a', text: '选择安抚女帝并稳住朝堂', x: 200, y: 100 },
      { id: 'b', text: '选择强硬回击并发动政变', x: 200, y: 100 },
      { id: 'c', text: '选择沉默旁观等待时机', x: 200, y: 100 },
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
