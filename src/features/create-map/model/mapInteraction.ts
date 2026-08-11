import type { LocalCollisionShape, Point } from './mapPlanSchema';
import type { MapSceneV2, ObstacleEntity } from './mapSceneSchema';
import type { MapSceneV2Command } from './mapSceneReducer';
import { snapPoint } from './coordinates';

export type MapInteraction =
  | { kind: 'entity-drag'; entity: ObstacleEntity; start: Point }
  | { kind: 'collision-rectangle-draw'; entity: ObstacleEntity; start: Point }
  | { kind: 'collision-circle-draw'; entity: ObstacleEntity; start: Point }
  | { kind: 'collision-vertex-drag'; entity: ObstacleEntity; vertexIndex: number };

export function interactionDelta(start: Point, current: Point, gridSize: number | null): Point {
  const delta = { x: current.x - start.x, y: current.y - start.y };
  return gridSize === null ? delta : snapPoint(delta, gridSize);
}

export function mapPointToEntityLocal(entity: ObstacleEntity, point: Point): Point {
  const radians = (-entity.rotation * Math.PI) / 180;
  const translatedX = point.x - entity.position.x;
  const translatedY = point.y - entity.position.y;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: (translatedX * cos - translatedY * sin) / entity.scale,
    y: (translatedX * sin + translatedY * cos) / entity.scale,
  };
}

function collisionForDrag(
  interaction: Extract<MapInteraction, { kind: 'collision-rectangle-draw' | 'collision-circle-draw' }>,
  current: Point,
): LocalCollisionShape | null {
  const delta = interactionDelta(interaction.start, current, null);
  if (interaction.kind === 'collision-rectangle-draw') {
    if (delta.x === 0 || delta.y === 0) return null;
    return {
      shape: 'rectangle',
      x: interaction.start.x + Math.min(0, delta.x),
      y: interaction.start.y + Math.min(0, delta.y),
      width: Math.abs(delta.x),
      height: Math.abs(delta.y),
    };
  }
  if (delta.x === 0 && delta.y === 0) return null;
  return {
    shape: 'circle',
    cx: interaction.start.x,
    cy: interaction.start.y,
    radius: Math.hypot(delta.x, delta.y),
  };
}

export function commandForInteraction(
  interaction: MapInteraction,
  current: Point,
  gridSize: number | null,
): MapSceneV2Command | null {
  if (interaction.kind === 'entity-drag') {
    const delta = interactionDelta(interaction.start, current, gridSize);
    if (delta.x === 0 && delta.y === 0) return null;
    return {
      type: 'entity/move',
      id: interaction.entity.id,
      position: {
        x: interaction.entity.position.x + delta.x,
        y: interaction.entity.position.y + delta.y,
      },
    };
  }
  if (interaction.kind === 'collision-vertex-drag') {
    if (interaction.entity.collision.shape !== 'polygon') return null;
    const points = interaction.entity.collision.points.map((point, index) =>
      index === interaction.vertexIndex ? { ...current } : { ...point }
    );
    return {
      type: 'entity/collision',
      id: interaction.entity.id,
      collision: { shape: 'polygon', points },
    };
  }
  const collision = collisionForDrag(interaction, current);
  return collision ? { type: 'entity/collision', id: interaction.entity.id, collision } : null;
}

export function previewInteraction(
  scene: MapSceneV2,
  interaction: MapInteraction | null,
  current: Point | null,
  gridSize: number | null,
): MapSceneV2 {
  if (!interaction || !current) return scene;
  const command = commandForInteraction(interaction, current, gridSize);
  if (!command || (command.type !== 'entity/move' && command.type !== 'entity/collision')) return scene;
  return {
    ...scene,
    obstacleEntities: scene.obstacleEntities.map((entity) => {
      if (entity.id !== command.id) return entity;
      return command.type === 'entity/move'
        ? { ...entity, position: command.position }
        : { ...entity, collision: command.collision };
    }),
  };
}
