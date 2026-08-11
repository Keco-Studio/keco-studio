import type { Point } from './mapPlanSchema';

export type MapViewport = {
  zoom: number;
  panX: number;
  panY: number;
};

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

export function screenToMap(point: Point, viewport: MapViewport): Point {
  assertPositiveFinite(viewport.zoom, 'zoom');
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom,
  };
}

export function mapToScreen(point: Point, viewport: MapViewport): Point {
  assertPositiveFinite(viewport.zoom, 'zoom');
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY,
  };
}

export function snapPoint(point: Point, gridSize: number): Point {
  assertPositiveFinite(gridSize, 'gridSize');
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}
