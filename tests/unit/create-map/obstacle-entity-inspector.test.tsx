import React from 'react';
import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { ObstacleEntityInspector, collisionForType } from '@/features/create-map/components/ObstacleEntityInspector';
import { makeValidMapSceneV2 } from './fixtures';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

describe('Obstacle entity inspector', () => {
  it('exposes transform, collision, duplicate, and delete controls without legacy inpaint UI', () => {
    const entity = makeValidMapSceneV2().obstacleEntities[0];
    const markup = renderToStaticMarkup(React.createElement(ObstacleEntityInspector, {
      entity,
      onMove: () => undefined,
      onTransform: () => undefined,
      onZIndexChange: () => undefined,
      onCollisionChange: () => undefined,
      onDuplicate: () => undefined,
      onDelete: () => undefined,
    }));

    expect(markup).toContain('Obstacle');
    expect(markup).toContain('Scale');
    expect(markup).toContain('Rotation');
    expect(markup).toContain('Local collision');
    expect(markup).toContain('Duplicate');
    expect(markup).toContain('Delete');
    expect(markup).not.toContain('Inpaint');
    expect(markup).not.toContain('Regenerate');
  });

  it('creates deterministic valid defaults for each collision mode', () => {
    expect(collisionForType('rectangle')).toEqual({ shape: 'rectangle', x: -16, y: -32, width: 32, height: 32 });
    expect(collisionForType('circle')).toEqual({ shape: 'circle', cx: 0, cy: -16, radius: 16 });
    expect(collisionForType('polygon').shape).toBe('polygon');
  });
});
