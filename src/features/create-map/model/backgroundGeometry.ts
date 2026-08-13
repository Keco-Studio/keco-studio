import type { MapPlanV2, Point } from './mapPlanSchema';

export type BackgroundCell = {
  x: number;
  y: number;
  assetKey: string;
  connectivityMask: number;
};

export type BackgroundLayerCell = {
  x: number;
  y: number;
  layers: Array<{ assetKey: string; connectivityMask: number }>;
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

function rasterizeConnectedPath(
  points: Point[],
  columns: number,
  rows: number,
  tileSize: number,
): boolean[][] {
  const grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => false));
  const cell = (point: Point) => ({
    x: Math.max(0, Math.min(columns - 1, Math.floor(point.x / tileSize))),
    y: Math.max(0, Math.min(rows - 1, Math.floor(point.y / tileSize))),
  });
  const mark = (x: number, y: number) => { grid[y][x] = true; };
  for (let index = 1; index < points.length; index += 1) {
    const start = cell(points[index - 1]);
    const end = cell(points[index]);
    let x = start.x;
    let y = start.y;
    const dx = Math.abs(end.x - x);
    const dy = Math.abs(end.y - y);
    const stepX = x < end.x ? 1 : -1;
    const stepY = y < end.y ? 1 : -1;
    let error = dx - dy;
    mark(x, y);
    while (x !== end.x || y !== end.y) {
      const doubled = error * 2;
      if (doubled > -dy && x !== end.x) {
        error -= dy;
        x += stepX;
        mark(x, y);
      }
      if (doubled < dx && y !== end.y) {
        error += dx;
        y += stepY;
        mark(x, y);
      }
    }
  }
  return grid;
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

function isBridgePath(path: { assetKey?: string; name?: string; prompt?: string }): boolean {
  return /\bbridge\b/i.test(`${path.assetKey} ${path.name ?? ''} ${path.prompt ?? ''}`);
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
  return rasterizeBackgroundLayers(plan).map((cell) => ({
    x: cell.x,
    y: cell.y,
    ...cell.layers[cell.layers.length - 1],
  }));
}

export function rasterizeBackgroundLayers(plan: MapPlanV2): BackgroundLayerCell[] {
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

  const pathGrids = plan.background.paths
    .map((path, index) => ({ path, index }))
    .sort((left, right) => left.path.zIndex - right.path.zIndex || left.index - right.index)
    .map(({ path }) => {
      const grid = rasterizeConnectedPath(path.points, columns, rows, plan.map.tileSize);
      return {
        path,
        grid,
        assetGrid: grid.map((row) => row.map((active) => active ? path.assetKey : '')),
      };
    });

  const cells: BackgroundLayerCell[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const assetKey = assetGrid[y][x];
      cells.push({
        x,
        y,
        layers: [
          // Terrain atlases use corner-based Wang rules. Until regions are
          // vertex-rasterized, use the provider's fully-filled surface tile.
          { assetKey, connectivityMask: 15 },
          ...pathGrids.flatMap(({ path, grid, assetGrid: pathAssetGrid }) => {
            if (!grid[y][x]) return [];
            return [{
              assetKey: path.assetKey,
              // PixelLab's bridge output is a complete deck tile. Repeating it
              // avoids inventing rails/corners when a provider variation lacks
              // a straight mask, while ordinary roads keep exact adjacency.
              connectivityMask: isBridgePath(path)
                ? 15
                : matrixConnectivityMask(pathAssetGrid, x, y, path.assetKey),
            }];
          }),
        ],
      });
    }
  }
  return cells;
}
