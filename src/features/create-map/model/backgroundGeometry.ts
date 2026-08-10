import type { MapPlanV2, Point } from './mapPlanSchema';

export type BackgroundCell = {
  x: number;
  y: number;
  assetKey: string;
  connectivityMask: number;
};

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
      point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
        (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)
  ));
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function distanceToPath(point: Point, points: Point[]): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, points[index - 1], points[index]));
  }
  return distance;
}

function matrixConnectivityMask(
  cells: readonly (readonly string[])[],
  x: number,
  y: number,
  key: string
): number {
  let mask = 0;
  if (cells[y - 1]?.[x] === key) mask |= 1;
  if (cells[y]?.[x + 1] === key) mask |= 2;
  if (cells[y + 1]?.[x] === key) mask |= 4;
  if (cells[y]?.[x - 1] === key) mask |= 8;
  return mask;
}

export function connectivityMask(
  cells: readonly (readonly string[])[],
  x: number,
  y: number,
  key: string
): number;
export function connectivityMask(
  cells: readonly BackgroundCell[],
  x: number,
  y: number,
  key: string
): number;
export function connectivityMask(
  cells: readonly (readonly string[])[] | readonly BackgroundCell[],
  x: number,
  y: number,
  key: string
): number {
  if (cells.length === 0) return 0;
  if (Array.isArray(cells[0])) {
    return matrixConnectivityMask(cells as readonly (readonly string[])[], x, y, key);
  }
  const keyedCells = new Map(
    (cells as readonly BackgroundCell[]).map((cell) => [`${cell.x}:${cell.y}`, cell.assetKey])
  );
  let mask = 0;
  if (keyedCells.get(`${x}:${y - 1}`) === key) mask |= 1;
  if (keyedCells.get(`${x + 1}:${y}`) === key) mask |= 2;
  if (keyedCells.get(`${x}:${y + 1}`) === key) mask |= 4;
  if (keyedCells.get(`${x - 1}:${y}`) === key) mask |= 8;
  return mask;
}

export function rasterizeBackgroundLayout(plan: MapPlanV2): BackgroundCell[] {
  const columns = plan.map.width / plan.map.tileSize;
  const rows = plan.map.height / plan.map.tileSize;
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns <= 0 || rows <= 0) return [];

  const assetGrid = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => plan.background.baseTerrainKey)
  );

  plan.background.regions.forEach((region) => {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const center = {
          x: (x + 0.5) * plan.map.tileSize,
          y: (y + 0.5) * plan.map.tileSize,
        };
        if (pointInPolygon(center, region.points)) assetGrid[y][x] = region.terrainKey;
      }
    }
  });

  plan.background.paths
    .map((path, index) => ({ path, index }))
    .sort((left, right) => left.path.zIndex - right.path.zIndex || left.index - right.index)
    .forEach(({ path }) => {
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const center = {
            x: (x + 0.5) * plan.map.tileSize,
            y: (y + 0.5) * plan.map.tileSize,
          };
          if (distanceToPath(center, path.points) <= path.width / 2) assetGrid[y][x] = path.assetKey;
        }
      }
    });

  const cells: BackgroundCell[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const assetKey = assetGrid[y][x];
      cells.push({
        x,
        y,
        assetKey,
        connectivityMask: matrixConnectivityMask(assetGrid, x, y, assetKey),
      });
    }
  }
  return cells;
}
