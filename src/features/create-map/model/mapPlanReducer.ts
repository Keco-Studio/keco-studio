import type {
  BackgroundPath,
  MapPlanV2,
  PlannedObstacleEntity,
  Point,
  TerrainRegion,
} from './mapPlanSchema';

export const MAX_MAP_PLAN_HISTORY = 100;

export type MapPlanCommand =
  | { type: 'plan/update'; plan: MapPlanV2 }
  | { type: 'region/add'; region: TerrainRegion }
  | { type: 'region/update'; region: TerrainRegion }
  | { type: 'region/delete'; id: string }
  | { type: 'path/add'; path: BackgroundPath }
  | { type: 'path/update'; path: BackgroundPath }
  | { type: 'path/delete'; id: string }
  | { type: 'placement/move'; id: string; position: Point };

export type MapPlanEditorState = {
  past: MapPlanV2[];
  present: MapPlanV2;
  future: MapPlanV2[];
};

export function createMapPlanEditorState(plan: MapPlanV2): MapPlanEditorState {
  return { past: [], present: plan, future: [] };
}

function clonePoints(points: Point[]): Point[] {
  return points.map((point) => ({ ...point }));
}

function cloneRegion(region: TerrainRegion): TerrainRegion {
  return { ...region, points: clonePoints(region.points) };
}

function clonePath(path: BackgroundPath): BackgroundPath {
  return { ...path, points: clonePoints(path.points) };
}

function replaceRegionById(values: TerrainRegion[], replacement: TerrainRegion): TerrainRegion[] | null {
  const index = values.findIndex((value) => value.id === replacement.id);
  if (index < 0) return null;
  const next = [...values];
  next[index] = cloneRegion(replacement);
  return next;
}

function replacePathById(values: BackgroundPath[], replacement: BackgroundPath): BackgroundPath[] | null {
  const index = values.findIndex((value) => value.id === replacement.id);
  if (index < 0) return null;
  const next = [...values];
  next[index] = clonePath(replacement);
  return next;
}

function movePlacement(placement: PlannedObstacleEntity, id: string, position: Point): PlannedObstacleEntity {
  if (placement.id !== id) return placement;
  if (placement.position.x === position.x && placement.position.y === position.y) return placement;
  return { ...placement, position: { ...position } };
}

function applyMapPlanCommand(plan: MapPlanV2, command: MapPlanCommand): MapPlanV2 {
  switch (command.type) {
    case 'plan/update':
      return command.plan === plan ? plan : command.plan;
    case 'region/add':
      if (plan.background.regions.some((region) => region.id === command.region.id)) return plan;
      return {
        ...plan,
        background: {
          ...plan.background,
          regions: [...plan.background.regions, cloneRegion(command.region)],
        },
      };
    case 'region/update': {
      const regions = replaceRegionById(plan.background.regions, command.region);
      return regions ? { ...plan, background: { ...plan.background, regions } } : plan;
    }
    case 'region/delete': {
      const regions = plan.background.regions.filter((region) => region.id !== command.id);
      return regions.length === plan.background.regions.length
        ? plan
        : { ...plan, background: { ...plan.background, regions } };
    }
    case 'path/add':
      if (plan.background.paths.some((path) => path.id === command.path.id)) return plan;
      return {
        ...plan,
        background: {
          ...plan.background,
          paths: [...plan.background.paths, clonePath(command.path)],
        },
      };
    case 'path/update': {
      const paths = replacePathById(plan.background.paths, command.path);
      return paths ? { ...plan, background: { ...plan.background, paths } } : plan;
    }
    case 'path/delete': {
      const paths = plan.background.paths.filter((path) => path.id !== command.id);
      return paths.length === plan.background.paths.length
        ? plan
        : { ...plan, background: { ...plan.background, paths } };
    }
    case 'placement/move': {
      let changed = false;
      const obstaclePlacements = plan.obstaclePlacements.map((placement) => {
        const next = movePlacement(placement, command.id, command.position);
        if (next !== placement) changed = true;
        return next;
      });
      return changed ? { ...plan, obstaclePlacements } : plan;
    }
  }
}

export function reduceMapPlanCommand(state: MapPlanEditorState, command: MapPlanCommand): MapPlanEditorState {
  const next = applyMapPlanCommand(state.present, command);
  if (next === state.present) return state;
  return {
    past: [...state.past, state.present].slice(-MAX_MAP_PLAN_HISTORY),
    present: next,
    future: [],
  };
}

export function undoMapPlan(state: MapPlanEditorState): MapPlanEditorState {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1];
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future].slice(0, MAX_MAP_PLAN_HISTORY),
  };
}

export function redoMapPlan(state: MapPlanEditorState): MapPlanEditorState {
  if (state.future.length === 0) return state;
  const [next, ...future] = state.future;
  return {
    past: [...state.past, state.present].slice(-MAX_MAP_PLAN_HISTORY),
    present: next,
    future,
  };
}
