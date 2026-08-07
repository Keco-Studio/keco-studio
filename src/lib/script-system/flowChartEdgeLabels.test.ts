import { describe, expect, it } from '@jest/globals';
import {
  placeEdgeLabels,
  wrapEdgeLabel,
} from './flowChartEdgeLabels';

describe('wrapEdgeLabel', () => {
  it('keeps short text on one line', () => {
    expect(wrapEdgeLabel('Fortify')).toEqual(['Fortify']);
  });

  it('wraps long text onto multiple lines of at most 8 characters', () => {
    const text = 'ABCDEFGHabcdefgh';
    const lines = wrapEdgeLabel(text);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(text);
    expect(lines.every((line) => Array.from(line).length <= 8)).toBe(true);
  });

  it('truncates with ellipsis after the max line count', () => {
    const lines = wrapEdgeLabel(
      'OneTwoThreeFourFiveSixSevenEightNineTenABCDEFGH',
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
      { id: 'a', text: 'Left branch', x: 100, y: 80 },
      { id: 'b', text: 'Right branch', x: 320, y: 80 },
    ]);
    expect(placed[0]?.x).toBe(100);
    expect(placed[1]?.x).toBe(320);
    expect(placed[0]?.y).toBe(80);
    expect(placed[1]?.y).toBe(80);
  });

  it('nudges overlapping labels so their boxes no longer collide', () => {
    const placed = placeEdgeLabels([
      { id: 'a', text: 'Choose to calm the empress and stabilize court', x: 200, y: 100 },
      { id: 'b', text: 'Choose a hard counterattack and coup', x: 200, y: 100 },
      { id: 'c', text: 'Choose silence and wait for the moment', x: 200, y: 100 },
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
