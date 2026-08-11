import type { LocalCollisionShape, Obstacle, Point } from './mapPlanSchema';
import type { MapScene, MapSceneV2, ObstacleEntity } from './mapSceneSchema';

export const MAX_EDITOR_HISTORY = 100;

export type EditorCommand =
  | { type: 'object/move'; id: string; position: Point }
  | { type: 'object/transform'; id: string; scale: number; rotation: number }
  | { type: 'obstacle/add'; obstacle: Obstacle }
  | { type: 'obstacle/update'; obstacle: Obstacle }
  | { type: 'obstacle/delete'; id: string }
  | { type: 'layer/reorder'; layerId: string; toIndex: number }
  | { type: 'layer/visibility'; layerId: string; visible: boolean };

export type MapSceneV2Command =
  | { type: 'entity/add'; entity: ObstacleEntity }
  | { type: 'entity/move'; id: string; position: Point }
  | { type: 'entity/transform'; id: string; scale: number; rotation: number }
  | { type: 'entity/collision'; id: string; collision: LocalCollisionShape }
  | { type: 'entity/duplicate'; id: string; newId: string; offset: Point }
  | { type: 'entity/delete'; id: string }
  | { type: 'entity/z-order'; id: string; zIndex: number }
  | { type: 'layer/visibility'; layerId: string; visible: boolean };

export type EditorState<TScene extends MapScene | MapSceneV2 = MapScene> = {
  past: TScene[];
  present: TScene;
  future: TScene[];
};

export type EditorSelection =
  | { kind: 'layer' | 'object' | 'obstacle' | 'entity'; id: string }
  | null;

export function createEditorState<TScene extends MapScene | MapSceneV2>(scene: TScene): EditorState<TScene> {
  return { past: [], present: scene, future: [] };
}

// Selection belongs to the transient editor UI, never the durable scene or history.
export function selectEditorEntity(
  kind: Exclude<EditorSelection, null>['kind'],
  id: string
): EditorSelection {
  return { kind, id };
}

function clonePoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function cloneObstacle(obstacle: Obstacle): Obstacle {
  if (obstacle.shape === 'polygon') {
    return { ...obstacle, points: obstacle.points.map(clonePoint) };
  }
  return { ...obstacle };
}

function commit<TScene extends MapScene | MapSceneV2>(state: EditorState<TScene>, next: TScene): EditorState<TScene> {
  if (next === state.present) return state;
  return {
    past: [...state.past, state.present].slice(-MAX_EDITOR_HISTORY),
    present: next,
    future: [],
  };
}

function cloneLocalCollision(collision: LocalCollisionShape): LocalCollisionShape {
  return collision.shape === 'polygon'
    ? { ...collision, points: collision.points.map(clonePoint) }
    : { ...collision };
}

function cloneObstacleEntity(entity: ObstacleEntity): ObstacleEntity {
  return {
    ...entity,
    position: clonePoint(entity.position),
    groundAnchor: clonePoint(entity.groundAnchor),
    collision: cloneLocalCollision(entity.collision),
  };
}

function updateObject(scene: MapScene, command: Extract<EditorCommand, { type: 'object/move' | 'object/transform' }>): MapScene {
  let changed = false;
  const objects = scene.objects.map((object) => {
    if (object.id !== command.id) return object;
    if (command.type === 'object/move') {
      if (object.position.x === command.position.x && object.position.y === command.position.y) return object;
      changed = true;
      return { ...object, position: clonePoint(command.position) };
    }
    if (object.scale === command.scale && object.rotation === command.rotation) return object;
    changed = true;
    return { ...object, scale: command.scale, rotation: command.rotation };
  });
  return changed ? { ...scene, objects } : scene;
}

function updateObstacle(scene: MapScene, obstacle: Obstacle): MapScene {
  const index = scene.obstacles.findIndex((candidate) => candidate.id === obstacle.id);
  if (index < 0) return scene;
  const obstacles = [...scene.obstacles];
  obstacles[index] = cloneObstacle(obstacle);
  return { ...scene, obstacles };
}

function reorderLayer(scene: MapScene, layerId: string, toIndex: number): MapScene {
  const fromIndex = scene.layers.findIndex((layer) => layer.id === layerId);
  if (fromIndex < 0 || !Number.isInteger(toIndex)) return scene;
  const targetIndex = Math.max(0, Math.min(toIndex, scene.layers.length - 1));
  if (fromIndex === targetIndex) return scene;
  const layers = [...scene.layers];
  const [layer] = layers.splice(fromIndex, 1);
  layers.splice(targetIndex, 0, layer);
  return { ...scene, layers };
}

function applyCommand(scene: MapScene, command: EditorCommand): MapScene {
  switch (command.type) {
    case 'object/move':
    case 'object/transform':
      return updateObject(scene, command);
    case 'obstacle/add':
      if (scene.obstacles.some((obstacle) => obstacle.id === command.obstacle.id)) return scene;
      return { ...scene, obstacles: [...scene.obstacles, cloneObstacle(command.obstacle)] };
    case 'obstacle/update':
      return updateObstacle(scene, command.obstacle);
    case 'obstacle/delete': {
      const obstacles = scene.obstacles.filter((obstacle) => obstacle.id !== command.id);
      return obstacles.length === scene.obstacles.length ? scene : { ...scene, obstacles };
    }
    case 'layer/reorder':
      return reorderLayer(scene, command.layerId, command.toIndex);
    case 'layer/visibility': {
      let changed = false;
      const layers = scene.layers.map((layer) => {
        if (layer.id !== command.layerId || layer.visible === command.visible) return layer;
        changed = true;
        return { ...layer, visible: command.visible };
      });
      return changed ? { ...scene, layers } : scene;
    }
  }
}

function updateObstacleEntity(
  scene: MapSceneV2,
  id: string,
  update: (entity: ObstacleEntity) => ObstacleEntity
): MapSceneV2 {
  let changed = false;
  const obstacleEntities = scene.obstacleEntities.map((entity) => {
    if (entity.id !== id) return entity;
    const next = update(entity);
    if (next !== entity) changed = true;
    return next;
  });
  return changed ? { ...scene, obstacleEntities } : scene;
}

function applyMapSceneV2Command(scene: MapSceneV2, command: MapSceneV2Command): MapSceneV2 {
  switch (command.type) {
    case 'entity/add':
      if (scene.obstacleEntities.some((entity) => entity.id === command.entity.id)) return scene;
      return { ...scene, obstacleEntities: [...scene.obstacleEntities, cloneObstacleEntity(command.entity)] };
    case 'entity/move':
      return updateObstacleEntity(scene, command.id, (entity) =>
        entity.position.x === command.position.x && entity.position.y === command.position.y
          ? entity
          : { ...entity, position: clonePoint(command.position) }
      );
    case 'entity/transform':
      if (!Number.isFinite(command.scale) || command.scale <= 0 || !Number.isFinite(command.rotation)) return scene;
      return updateObstacleEntity(scene, command.id, (entity) =>
        entity.scale === command.scale && entity.rotation === command.rotation
          ? entity
          : { ...entity, scale: command.scale, rotation: command.rotation }
      );
    case 'entity/collision':
      return updateObstacleEntity(scene, command.id, (entity) => ({
        ...entity,
        collision: cloneLocalCollision(command.collision),
      }));
    case 'entity/duplicate': {
      if (scene.obstacleEntities.some((entity) => entity.id === command.newId)) return scene;
      const source = scene.obstacleEntities.find((entity) => entity.id === command.id);
      if (!source) return scene;
      const duplicate = cloneObstacleEntity(source);
      duplicate.id = command.newId;
      duplicate.position = {
        x: source.position.x + command.offset.x,
        y: source.position.y + command.offset.y,
      };
      return { ...scene, obstacleEntities: [...scene.obstacleEntities, duplicate] };
    }
    case 'entity/delete': {
      const obstacleEntities = scene.obstacleEntities.filter((entity) => entity.id !== command.id);
      return obstacleEntities.length === scene.obstacleEntities.length ? scene : { ...scene, obstacleEntities };
    }
    case 'entity/z-order':
      if (!Number.isInteger(command.zIndex)) return scene;
      return updateObstacleEntity(scene, command.id, (entity) =>
        entity.zIndex === command.zIndex ? entity : { ...entity, zIndex: command.zIndex }
      );
    case 'layer/visibility': {
      let changed = false;
      const layers = scene.layers.map((layer) => {
        if (layer.id !== command.layerId || layer.visible === command.visible) return layer;
        changed = true;
        return { ...layer, visible: command.visible };
      });
      return changed ? { ...scene, layers } : scene;
    }
  }
}

export function reduceEditorCommand(
  state: EditorState<MapScene>,
  command: EditorCommand
): EditorState<MapScene>;
export function reduceEditorCommand(
  state: EditorState<MapSceneV2>,
  command: MapSceneV2Command
): EditorState<MapSceneV2>;
export function reduceEditorCommand(
  state: EditorState<MapScene | MapSceneV2>,
  command: EditorCommand | MapSceneV2Command
): EditorState<MapScene | MapSceneV2> {
  if (state.present.schemaVersion === 2) {
    const next = applyMapSceneV2Command(state.present, command as MapSceneV2Command);
    return commit(state, next);
  }
  const next = applyCommand(state.present, command as EditorCommand);
  return commit(state, next);
}

export function undo<TScene extends MapScene | MapSceneV2>(state: EditorState<TScene>): EditorState<TScene> {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1];
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future].slice(0, MAX_EDITOR_HISTORY),
  };
}

export function redo<TScene extends MapScene | MapSceneV2>(state: EditorState<TScene>): EditorState<TScene> {
  if (state.future.length === 0) return state;
  const [next, ...future] = state.future;
  return {
    past: [...state.past, state.present].slice(-MAX_EDITOR_HISTORY),
    present: next,
    future,
  };
}
