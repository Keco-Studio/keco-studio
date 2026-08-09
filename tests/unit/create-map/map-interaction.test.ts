import { describe, expect, it } from '@jest/globals';
import {
  commandForInteraction,
  interactionDelta,
  previewInteraction,
  type MapInteraction,
} from '@/features/create-map/model/mapInteraction';
import { makeValidMapScene } from './fixtures';

describe('Create Map pointer interactions', () => {
  it('moves an object by the pointer delta without replacing its anchor with the pointer', () => {
    const scene = makeValidMapScene();
    const object = scene.objects[0];
    const interaction: MapInteraction = {
      kind: 'object-drag',
      object,
      start: { x: 70, y: 55 },
    };

    const preview = previewInteraction(scene, interaction, { x: 90, y: 85 }, null);
    expect(preview.objects[0].position).toEqual({ x: 116, y: 110 });
    expect(commandForInteraction(interaction, { x: 90, y: 85 }, null)).toEqual({
      type: 'object/move',
      id: object.id,
      position: { x: 116, y: 110 },
    });
    expect(scene.objects[0].position).toEqual({ x: 96, y: 80 });
  });

  it('snaps the drag delta without snapping the grab point or original entity offset', () => {
    expect(interactionDelta({ x: 70, y: 55 }, { x: 91, y: 84 }, 32)).toEqual({ x: 32, y: 32 });
    expect(interactionDelta({ x: 70, y: 55 }, { x: 91, y: 84 }, null)).toEqual({ x: 21, y: 29 });
  });

  it.each(['rectangle', 'circle', 'polygon'] as const)(
    'translates a %s obstacle in the preview and final command',
    (shape) => {
      const scene = makeValidMapScene();
      const obstacle = scene.obstacles.find((candidate) => candidate.shape === shape)!;
      const interaction: MapInteraction = { kind: 'obstacle-drag', obstacle, start: { x: 10, y: 20 } };
      const command = commandForInteraction(interaction, { x: 26, y: 44 }, null);
      const preview = previewInteraction(scene, interaction, { x: 26, y: 44 }, null);

      expect(command).toEqual({
        type: 'obstacle/update',
        obstacle: preview.obstacles.find((candidate) => candidate.id === obstacle.id),
      });
    }
  );

  it('keeps a circle centered on the raw pointer-down point when Snap is enabled', () => {
    const scene = makeValidMapScene();
    const interaction: MapInteraction = {
      kind: 'circle-draw',
      id: 'obstacle-4',
      start: { x: 45, y: 61 },
    };

    const preview = previewInteraction(scene, interaction, { x: 78, y: 94 }, 32);
    expect(preview.obstacles.at(-1)).toEqual({
      id: 'obstacle-4',
      shape: 'circle',
      cx: 45,
      cy: 61,
      radius: Math.hypot(32, 32),
    });
  });

  it('uses the same rectangle geometry for preview and commit and discards zero-size shapes', () => {
    const scene = makeValidMapScene();
    const interaction: MapInteraction = {
      kind: 'rectangle-draw',
      id: 'obstacle-4',
      start: { x: 45, y: 61 },
    };
    const preview = previewInteraction(scene, interaction, { x: 80, y: 92 }, null);

    expect(commandForInteraction(interaction, { x: 80, y: 92 }, null)).toEqual({
      type: 'obstacle/add',
      obstacle: preview.obstacles.at(-1),
    });
    expect(commandForInteraction(interaction, interaction.start, null)).toBeNull();
    expect(commandForInteraction(interaction, { x: interaction.start.x, y: 92 }, null)).toBeNull();
  });
});
