import { describe, expect, it } from '@jest/globals';
import {
  connectivityMask,
  rasterizeBackgroundLayout,
} from '@/features/create-map/model/backgroundGeometry';
import { makeValidMapPlanV2 } from './fixtures';

describe('background geometry', () => {
  it('applies regions over the base before z-ordered paths', () => {
    const cells = rasterizeBackgroundLayout(makeValidMapPlanV2());

    expect(cells).toHaveLength(12);
    expect(cells.find((cell) => cell.x === 3 && cell.y === 2)?.assetKey).toBe('packed-earth');
    expect(cells.find((cell) => cell.x === 0 && cell.y === 0)?.assetKey).toBe('market-road-tiles');
    expect(cells.find((cell) => cell.x === 1 && cell.y === 2)?.assetKey).toBe('market-road-tiles');
  });

  it('uses north/east/south/west connectivity bits for a turning path', () => {
    expect(connectivityMask([
      ['road', 'road'],
      ['base', 'road'],
    ], 1, 0, 'road')).toBe(12);
  });
});
