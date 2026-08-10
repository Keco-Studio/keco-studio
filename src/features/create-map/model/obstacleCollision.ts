import type { LocalCollisionShape, Point } from './mapPlanSchema';
import type { ObstacleEntity } from './mapSceneSchema';

export type AlphaBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ObstacleAlphaMetrics = {
  alphaBounds: AlphaBounds | null;
  opaquePixelCount: number;
  visiblePixelCount: number;
  opaqueFillRatio: number;
};

export type WorldCollisionShape =
  | { shape: 'circle'; cx: number; cy: number; radius: number }
  | { shape: 'polygon'; points: Point[] };

export function deriveInitialLocalCollision(
  metrics: ObstacleAlphaMetrics,
  groundAnchor: Point
): LocalCollisionShape {
  const bounds = metrics.alphaBounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    throw new RangeError('Visible alpha bounds are required to derive obstacle collision');
  }
  if (!Number.isFinite(metrics.opaqueFillRatio) || metrics.opaqueFillRatio < 0 || metrics.opaqueFillRatio > 1) {
    throw new RangeError('Opaque fill ratio must be between 0 and 1');
  }

  const aspectRatio = bounds.width / bounds.height;
  if (aspectRatio >= 0.8 && aspectRatio <= 1.2 && metrics.opaqueFillRatio >= 0.62) {
    return {
      shape: 'circle',
      cx: bounds.x + bounds.width / 2 - groundAnchor.x,
      cy: bounds.y + bounds.height / 2 - groundAnchor.y,
      radius: Math.max(bounds.width, bounds.height) / 2,
    };
  }

  return {
    shape: 'rectangle',
    x: bounds.x - groundAnchor.x,
    y: bounds.y - groundAnchor.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function transformPoint(point: Point, entity: ObstacleEntity): Point {
  const scaledX = point.x * entity.scale;
  const scaledY = point.y * entity.scale;
  const radians = (entity.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const normalize = (value: number) => Math.round(value * 1e12) / 1e12;
  return {
    x: normalize(entity.position.x + scaledX * cos - scaledY * sin),
    y: normalize(entity.position.y + scaledX * sin + scaledY * cos),
  };
}

export function transformLocalCollision(entity: ObstacleEntity): WorldCollisionShape {
  const collision = entity.collision;
  if (collision.shape === 'circle') {
    const center = transformPoint({ x: collision.cx, y: collision.cy }, entity);
    return {
      shape: 'circle',
      cx: center.x,
      cy: center.y,
      radius: collision.radius * entity.scale,
    };
  }

  const points = collision.shape === 'polygon'
    ? collision.points
    : [
        { x: collision.x, y: collision.y },
        { x: collision.x + collision.width, y: collision.y },
        { x: collision.x + collision.width, y: collision.y + collision.height },
        { x: collision.x, y: collision.y + collision.height },
      ];
  return { shape: 'polygon', points: points.map((point) => transformPoint(point, entity)) };
}
