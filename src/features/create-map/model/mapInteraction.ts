import type { Obstacle, Point } from './mapPlanSchema';
import type { MapScene, ObjectInstance } from './mapSceneSchema';
import type { EditorCommand } from './mapSceneReducer';
import { snapPoint } from './coordinates';

export type MapInteraction =
  | { kind: 'object-drag'; object: ObjectInstance; start: Point }
  | { kind: 'obstacle-drag'; obstacle: Obstacle; start: Point }
  | { kind: 'rectangle-draw'; id: string; start: Point }
  | { kind: 'circle-draw'; id: string; start: Point };

export function interactionDelta(start: Point, current: Point, gridSize: number | null): Point {
  const delta = { x: current.x - start.x, y: current.y - start.y };
  return gridSize === null ? delta : snapPoint(delta, gridSize);
}

function translateObstacle(obstacle: Obstacle, delta: Point): Obstacle {
  if (obstacle.shape === 'rectangle') {
    return { ...obstacle, x: obstacle.x + delta.x, y: obstacle.y + delta.y };
  }
  if (obstacle.shape === 'circle') {
    return { ...obstacle, cx: obstacle.cx + delta.x, cy: obstacle.cy + delta.y };
  }
  return {
    ...obstacle,
    points: obstacle.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
  };
}

function createdObstacle(
  interaction: Extract<MapInteraction, { kind: 'rectangle-draw' | 'circle-draw' }>,
  current: Point,
  gridSize: number | null
): Obstacle | null {
  const delta = interactionDelta(interaction.start, current, gridSize);
  if (interaction.kind === 'rectangle-draw') {
    if (delta.x === 0 || delta.y === 0) return null;
    return {
      id: interaction.id,
      shape: 'rectangle',
      x: interaction.start.x + Math.min(0, delta.x),
      y: interaction.start.y + Math.min(0, delta.y),
      width: Math.abs(delta.x),
      height: Math.abs(delta.y),
    };
  }
  if (delta.x === 0 && delta.y === 0) return null;
  return {
    id: interaction.id,
    shape: 'circle',
    cx: interaction.start.x,
    cy: interaction.start.y,
    radius: Math.hypot(delta.x, delta.y),
  };
}

export function commandForInteraction(
  interaction: MapInteraction,
  current: Point,
  gridSize: number | null
): EditorCommand | null {
  const delta = interactionDelta(interaction.start, current, gridSize);
  if (interaction.kind === 'object-drag') {
    if (delta.x === 0 && delta.y === 0) return null;
    return {
      type: 'object/move',
      id: interaction.object.id,
      position: {
        x: interaction.object.position.x + delta.x,
        y: interaction.object.position.y + delta.y,
      },
    };
  }
  if (interaction.kind === 'obstacle-drag') {
    if (delta.x === 0 && delta.y === 0) return null;
    return { type: 'obstacle/update', obstacle: translateObstacle(interaction.obstacle, delta) };
  }
  const obstacle = createdObstacle(interaction, current, gridSize);
  return obstacle ? { type: 'obstacle/add', obstacle } : null;
}

export function previewInteraction(
  scene: MapScene,
  interaction: MapInteraction | null,
  current: Point | null,
  gridSize: number | null
): MapScene {
  if (!interaction || !current) return scene;
  const command = commandForInteraction(interaction, current, gridSize);
  if (!command) return scene;
  if (command.type === 'object/move') {
    return {
      ...scene,
      objects: scene.objects.map((object) => object.id === command.id
        ? { ...object, position: command.position }
        : object),
    };
  }
  if (command.type === 'obstacle/update') {
    return {
      ...scene,
      obstacles: scene.obstacles.map((obstacle) => obstacle.id === command.obstacle.id
        ? command.obstacle
        : obstacle),
    };
  }
  if (command.type === 'obstacle/add') {
    return { ...scene, obstacles: [...scene.obstacles, command.obstacle] };
  }
  return scene;
}
