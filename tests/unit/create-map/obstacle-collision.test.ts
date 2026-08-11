import { describe, expect, it } from '@jest/globals';
import {
  deriveInitialLocalCollision,
  transformLocalCollision,
} from '@/features/create-map/model/obstacleCollision';
import { makeValidMapSceneV2 } from './fixtures';

describe('obstacle collision geometry', () => {
  it('derives circles only for compact, sufficiently opaque alpha bounds', () => {
    expect(deriveInitialLocalCollision({
      alphaBounds: { x: 4, y: 6, width: 20, height: 22 },
      opaquePixelCount: 300,
      visiblePixelCount: 400,
      opaqueFillRatio: 0.75,
    }, { x: 16, y: 28 })).toEqual({
      shape: 'circle',
      cx: -2,
      cy: -11,
      radius: 11,
    });

    expect(deriveInitialLocalCollision({
      alphaBounds: { x: 4, y: 6, width: 24, height: 12 },
      opaquePixelCount: 200,
      visiblePixelCount: 288,
      opaqueFillRatio: 0.7,
    }, { x: 16, y: 28 })).toEqual({
      shape: 'rectangle',
      x: -12,
      y: -22,
      width: 24,
      height: 12,
    });
  });

  it('applies the same scale and degree rotation to local collision points', () => {
    const entity = makeValidMapSceneV2().obstacleEntities[0];
    entity.position = { x: 100, y: 50 };
    entity.scale = 2;
    entity.rotation = 90;
    entity.collision = { shape: 'rectangle', x: 0, y: 0, width: 10, height: 20 };

    const transformed = transformLocalCollision(entity);

    expect(transformed.shape).toBe('polygon');
    if (transformed.shape === 'polygon') {
      expect(transformed.points).toEqual([
        { x: 100, y: 50 },
        { x: 100, y: 70 },
        { x: 60, y: 70 },
        { x: 60, y: 50 },
      ]);
    }
  });
});
