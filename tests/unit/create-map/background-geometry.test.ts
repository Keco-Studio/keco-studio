import { describe, expect, it } from '@jest/globals';
import {
  connectivityMask,
  rasterizeBackgroundLayers,
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

  it('keeps terrain under transparent path layers in z-order', () => {
    const cells = rasterizeBackgroundLayers(makeValidMapPlanV2());
    const roadCell = cells.find((cell) => cell.x === 0 && cell.y === 0);

    expect(roadCell?.layers.map((layer) => layer.assetKey)).toEqual([
      'meadow-grass',
      'market-road-tiles',
    ]);
  });

  it('rasterizes diagonal paths as a one-tile, four-connected centerline', () => {
    const plan = makeValidMapPlanV2();
    plan.background.paths[0].width = plan.map.tileSize * 3;
    plan.background.paths[0].points = [
      { x: 0, y: 0 },
      { x: plan.map.width - 1, y: plan.map.height - 1 },
    ];
    const pathCells = rasterizeBackgroundLayers(plan).filter((cell) => cell.layers.length > 1);
    const keys = new Set(pathCells.map((cell) => `${cell.x}:${cell.y}`));
    const pending = [pathCells[0]];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const cell = pending.pop();
      if (!cell) continue;
      const key = `${cell.x}:${cell.y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy]) => {
        const neighbor = `${cell.x + dx}:${cell.y + dy}`;
        const next = pathCells.find((candidate) => `${candidate.x}:${candidate.y}` === neighbor);
        if (keys.has(neighbor) && next) pending.push(next);
      });
    }

    expect(visited.size).toBe(pathCells.length);
    expect(pathCells.length).toBeLessThanOrEqual(
      plan.map.width / plan.map.tileSize + plan.map.height / plan.map.tileSize,
    );
  });

  it('repeats the complete bridge deck mask across a diagonal bridge', () => {
    const plan = makeValidMapPlanV2();
    plan.background.paths[0].name = 'Wooden bridge';
    plan.background.paths[0].prompt = 'Wooden bridge deck over shallow water.';
    plan.background.paths[0].terrainKey = 'meadow-grass';
    plan.background.paths[0].points = [{ x: 0, y: 0 }, { x: plan.map.width - 1, y: plan.map.height - 1 }];

    const bridgeCells = rasterizeBackgroundLayers(plan).filter((cell) => cell.layers.length > 1);
    expect(bridgeCells.length).toBeGreaterThan(0);
    expect(bridgeCells.every((cell) => cell.layers.at(-1)?.connectivityMask === 15)).toBe(true);
  });
});
