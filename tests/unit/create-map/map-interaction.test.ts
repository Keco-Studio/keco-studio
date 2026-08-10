import { describe, expect, it } from '@jest/globals';
import {
  commandForInteraction,
  interactionDelta,
  mapPointToEntityLocal,
  previewInteraction,
  type MapInteraction,
} from '@/features/create-map/model/mapInteraction';
import { makeValidMapSceneV2 } from './fixtures';

describe('Create Map V2 pointer interactions', () => {
  it('moves one complete obstacle entity by a snapped pointer delta', () => {
    const scene = makeValidMapSceneV2();
    const entity = scene.obstacleEntities[0];
    const interaction: MapInteraction = { kind: 'entity-drag', entity, start: { x: 70, y: 55 } };

    expect(interactionDelta({ x: 70, y: 55 }, { x: 91, y: 84 }, 32)).toEqual({ x: 32, y: 32 });
    expect(commandForInteraction(interaction, { x: 91, y: 84 }, 32)).toEqual({
      type: 'entity/move', id: 'rock-1', position: { x: 128, y: 96 },
    });
    expect(previewInteraction(scene, interaction, { x: 91, y: 84 }, 32).obstacleEntities[0].position)
      .toEqual({ x: 128, y: 96 });
    expect(scene.obstacleEntities[0].position).toEqual({ x: 96, y: 64 });
  });

  it('draws a local rectangle collision without changing the entity transform', () => {
    const scene = makeValidMapSceneV2();
    const entity = scene.obstacleEntities[0];
    const interaction: MapInteraction = {
      kind: 'collision-rectangle-draw', entity, start: { x: -12, y: -20 },
    };

    expect(commandForInteraction(interaction, { x: 18, y: 14 }, null)).toEqual({
      type: 'entity/collision',
      id: 'rock-1',
      collision: { shape: 'rectangle', x: -12, y: -20, width: 30, height: 34 },
    });
  });

  it('moves one polygon vertex in local space after inverse entity rotation and scale', () => {
    const scene = makeValidMapSceneV2();
    const entity = {
      ...scene.obstacleEntities[0],
      scale: 2,
      rotation: 90,
      collision: { shape: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 0, y: -12 }] },
    };
    const local = mapPointToEntityLocal(entity, { x: 96, y: 64 });
    expect(local).toEqual({ x: 0, y: 0 });

    const interaction: MapInteraction = { kind: 'collision-vertex-drag', entity, vertexIndex: 1 };
    expect(commandForInteraction(interaction, { x: 16, y: -8 }, null)).toEqual({
      type: 'entity/collision',
      id: 'rock-1',
      collision: { shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 16, y: -8 }, { x: 0, y: -12 }] },
    });
  });

  it('discards zero-size collision drawings', () => {
    const scene = makeValidMapSceneV2();
    const entity = scene.obstacleEntities[0];
    expect(commandForInteraction({ kind: 'collision-circle-draw', entity, start: { x: 0, y: 0 } }, { x: 0, y: 0 }, null)).toBeNull();
    expect(commandForInteraction({ kind: 'collision-rectangle-draw', entity, start: { x: 0, y: 0 } }, { x: 0, y: 10 }, null)).toBeNull();
  });
});
