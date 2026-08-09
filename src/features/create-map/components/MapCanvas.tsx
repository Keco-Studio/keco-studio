'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Obstacle, Point } from '../model/mapPlanSchema';
import type { MapScene } from '../model/mapSceneSchema';
import type { EditorCommand, EditorSelection } from '../model/mapSceneReducer';
import { screenToMap, snapPoint, type MapViewport } from '../model/coordinates';
import {
  commandForInteraction,
  previewInteraction,
  type MapInteraction,
} from '../model/mapInteraction';
import type { MapTool } from './MapToolbar';
import styles from '../CreateMapWorkbench.module.css';

export type MapRenderAsset = {
  assetKey: string;
  kind: 'terrain' | 'road' | 'object';
  underlayAssetKey?: string;
  image?: CanvasImageSource;
  color?: string;
  width?: number;
  height?: number;
};

export type MapRenderViewport = MapViewport & {
  devicePixelRatio: number;
};

export type MapRenderSelection = EditorSelection;

const FALLBACK_COLORS = {
  terrain: '#88a96b',
  road: '#b99d72',
  object: '#466c50',
} as const;

function drawAssetRect(
  context: CanvasRenderingContext2D,
  asset: MapRenderAsset | undefined,
  kind: MapRenderAsset['kind'],
  x: number,
  y: number,
  width: number,
  height: number
) {
  if (asset?.image) {
    if ((kind === 'terrain' || kind === 'road') && 'naturalWidth' in asset.image && asset.image.naturalWidth >= width && asset.image.naturalHeight >= height) {
      context.drawImage(asset.image, 0, 0, width, height, x, y, width, height);
    } else {
      context.drawImage(asset.image, x, y, width, height);
    }
    return;
  }
  context.fillStyle = asset?.color ?? FALLBACK_COLORS[kind];
  context.fillRect(x, y, width, height);
}

function drawObstacle(
  context: CanvasRenderingContext2D,
  obstacle: Obstacle,
  appearance = { fill: 'rgba(221, 84, 84, 0.13)', stroke: '#d34d4d', lineWidth: 1.5 }
) {
  context.beginPath();
  if (obstacle.shape === 'rectangle') {
    context.rect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
  } else if (obstacle.shape === 'circle') {
    context.arc(obstacle.cx, obstacle.cy, obstacle.radius, 0, Math.PI * 2);
  } else {
    obstacle.points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
    context.closePath();
  }
  context.fillStyle = appearance.fill;
  context.strokeStyle = appearance.stroke;
  context.lineWidth = appearance.lineWidth;
  context.fill();
  context.stroke();
}

function pointInPolygon(point: Point, points: Point[]): boolean {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const a = points[current];
    const b = points[previous];
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function obstacleContainsPoint(obstacle: Obstacle, point: Point): boolean {
  if (obstacle.shape === 'rectangle') {
    return point.x >= obstacle.x && point.x <= obstacle.x + obstacle.width && point.y >= obstacle.y && point.y <= obstacle.y + obstacle.height;
  }
  if (obstacle.shape === 'circle') {
    return Math.hypot(point.x - obstacle.cx, point.y - obstacle.cy) <= obstacle.radius;
  }
  return pointInPolygon(point, obstacle.points);
}

export function renderMapScene(
  context: CanvasRenderingContext2D,
  scene: MapScene,
  assets: ReadonlyMap<string, MapRenderAsset>,
  viewport: MapRenderViewport,
  selection: MapRenderSelection = null
) {
  const dpr = Math.max(1, viewport.devicePixelRatio || 1);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.setTransform(dpr * viewport.zoom, 0, 0, dpr * viewport.zoom, dpr * viewport.panX, dpr * viewport.panY);
  context.fillStyle = '#e8ece5';
  context.fillRect(0, 0, scene.size.width, scene.size.height);

  const visibleLayers = new Set(scene.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const drawTiles = (kind: 'terrain' | 'road') => {
    scene.tiles.forEach((tile) => {
      if (!visibleLayers.has(tile.layerId)) return;
      const selected = assets.get(tile.terrainKey);
      const asset = kind === 'terrain' && selected?.kind === 'road' && selected.underlayAssetKey
        ? assets.get(selected.underlayAssetKey)
        : selected;
      if ((asset?.kind ?? 'terrain') !== kind) return;
      drawAssetRect(
        context,
        asset,
        kind,
        tile.x * scene.size.tileSize,
        tile.y * scene.size.tileSize,
        scene.size.tileSize,
        scene.size.tileSize
      );
    });
  };
  drawTiles('terrain');
  drawTiles('road');

  [...scene.objects]
    .filter((object) => visibleLayers.has(object.layerId))
    .sort((left, right) => left.zIndex - right.zIndex)
    .forEach((object) => {
      const asset = assets.get(object.assetKey);
      const width = (asset?.width ?? 48) * object.scale;
      const height = (asset?.height ?? 56) * object.scale;
      context.save();
      context.translate(object.position.x, object.position.y);
      context.rotate((object.rotation * Math.PI) / 180);
      drawAssetRect(
        context,
        asset,
        'object',
        -object.groundAnchor.x * object.scale,
        -object.groundAnchor.y * object.scale,
        width,
        height
      );
      context.restore();
    });

  const showObstacles = scene.layers.some((layer) => layer.kind === 'overlay' && layer.visible);
  if (showObstacles) scene.obstacles.forEach((obstacle) => drawObstacle(context, obstacle));

  if (selection?.kind === 'object') {
    const object = scene.objects.find((candidate) => candidate.id === selection.id);
    if (object && visibleLayers.has(object.layerId)) {
      const asset = assets.get(object.assetKey);
      const width = (asset?.width ?? 48) * object.scale;
      const height = (asset?.height ?? 56) * object.scale;
      context.strokeStyle = '#0b78d0';
      context.lineWidth = 2;
      context.setLineDash([4, 3]);
      context.strokeRect(
        object.position.x - object.groundAnchor.x * object.scale,
        object.position.y - object.groundAnchor.y * object.scale,
        width,
        height
      );
      context.setLineDash([]);
    }
  } else if (selection?.kind === 'obstacle') {
    const obstacle = scene.obstacles.find((candidate) => candidate.id === selection.id);
    if (obstacle) {
      drawObstacle(context, obstacle, { fill: 'rgba(11, 120, 208, 0.08)', stroke: '#0b78d0', lineWidth: 3 });
    }
  }
  context.restore();
}

type MapCanvasProps = {
  scene: MapScene;
  assets: ReadonlyMap<string, MapRenderAsset>;
  tool: MapTool;
  viewport: MapViewport;
  snapToGrid: boolean;
  selection: EditorSelection;
  onCommand: (command: EditorCommand) => void;
  onSelectionChange: (selection: EditorSelection) => void;
  onViewportChange: (viewport: MapViewport) => void;
  onMaskPaint: (point: Point) => void;
};

function obstacleId(sequence: number) {
  return `obstacle-${sequence}`;
}

export function MapCanvas({
  scene,
  assets,
  tool,
  viewport,
  snapToGrid,
  selection,
  onCommand,
  onSelectionChange,
  onViewportChange,
  onMaskPaint,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handStartRef = useRef<{ point: Point; viewport: MapViewport } | null>(null);
  const obstacleSequenceRef = useRef(scene.obstacles.length + 1);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [interaction, setInteraction] = useState<MapInteraction | null>(null);
  const [interactionPoint, setInteractionPoint] = useState<Point | null>(null);

  const toRawMapPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return screenToMap({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport);
  }, [viewport]);

  const snapMapPoint = useCallback((point: Point) => {
    if (!snapToGrid) return point;
    return snapPoint(point, scene.size.tileSize);
  }, [scene.size.tileSize, snapToGrid]);
  const interactionGridSize = snapToGrid ? scene.size.tileSize : null;
  const renderedScene = useMemo(
    () => previewInteraction(scene, interaction, interactionPoint, interactionGridSize),
    [interaction, interactionGridSize, interactionPoint, scene]
  );

  const finishPolygon = useCallback(() => {
    if (polygonPoints.length >= 3) {
      const id = obstacleId(obstacleSequenceRef.current++);
      onCommand({ type: 'obstacle/add', obstacle: { id, shape: 'polygon', points: polygonPoints } });
      onSelectionChange({ kind: 'obstacle', id });
    }
    setPolygonPoints([]);
  }, [onCommand, onSelectionChange, polygonPoints]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      setCanvasSize({ width, height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    renderMapScene(context, renderedScene, assets, { ...viewport, devicePixelRatio: window.devicePixelRatio || 1 }, selection);
    if (polygonPoints.length > 0) {
      const dpr = window.devicePixelRatio || 1;
      context.save();
      context.setTransform(dpr * viewport.zoom, 0, 0, dpr * viewport.zoom, dpr * viewport.panX, dpr * viewport.panY);
      context.beginPath();
      polygonPoints.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
      context.strokeStyle = '#0b78d0';
      context.lineWidth = 2;
      context.stroke();
      context.restore();
    }
  }, [assets, canvasSize, polygonPoints, renderedScene, selection, viewport]);

  const startSelectionInteraction = (point: Point) => {
    const object = [...scene.objects].reverse().find((candidate) => (
      candidate.movable &&
      Math.abs(candidate.position.x - point.x) <= 28 * candidate.scale &&
      Math.abs(candidate.position.y - point.y) <= 32 * candidate.scale
    ));
    if (object) {
      onSelectionChange({ kind: 'object', id: object.id });
      setInteraction({ kind: 'object-drag', object, start: point });
      setInteractionPoint(point);
      return;
    }
    const obstacle = [...scene.obstacles].reverse().find((candidate) => obstacleContainsPoint(candidate, point));
    onSelectionChange(obstacle ? { kind: 'obstacle', id: obstacle.id } : null);
    setInteraction(obstacle ? { kind: 'obstacle-drag', obstacle, start: point } : null);
    setInteractionPoint(obstacle ? point : null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rawPoint = toRawMapPoint(event);
    if (tool === 'hand') {
      handStartRef.current = { point: { x: event.clientX, y: event.clientY }, viewport };
    } else if (tool === 'select') {
      startSelectionInteraction(rawPoint);
    } else if (tool === 'rectangle' || tool === 'circle') {
      const id = obstacleId(obstacleSequenceRef.current++);
      setInteraction({ kind: tool === 'rectangle' ? 'rectangle-draw' : 'circle-draw', id, start: rawPoint });
      setInteractionPoint(rawPoint);
    } else if (tool === 'polygon') {
      setPolygonPoints((current) => [...current, snapMapPoint(rawPoint)]);
    } else if (tool === 'mask') {
      onMaskPaint(snapMapPoint(rawPoint));
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'hand' && handStartRef.current) {
      const start = handStartRef.current;
      onViewportChange({
        ...start.viewport,
        panX: start.viewport.panX + event.clientX - start.point.x,
        panY: start.viewport.panY + event.clientY - start.point.y,
      });
    } else if (interaction && event.currentTarget.hasPointerCapture(event.pointerId)) {
      setInteractionPoint(toRawMapPoint(event));
    } else if (tool === 'mask' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      onMaskPaint(snapMapPoint(toRawMapPoint(event)));
    }
  };

  const clearInteraction = () => {
    setInteraction(null);
    setInteractionPoint(null);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (interaction) {
      const command = commandForInteraction(interaction, toRawMapPoint(event), interactionGridSize);
      if (command) {
        onCommand(command);
        if (command.type === 'obstacle/add') {
          onSelectionChange({ kind: 'obstacle', id: command.obstacle.id });
        }
      }
    }
    handStartRef.current = null;
    clearInteraction();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    handStartRef.current = null;
    clearInteraction();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className={styles.canvasViewport}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        aria-label="Editable map canvas"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={() => tool === 'polygon' && finishPolygon()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && tool === 'polygon') finishPolygon();
          if (event.key === 'Escape') setPolygonPoints([]);
        }}
      />
      <div className={styles.canvasCoordinates} aria-live="polite">{scene.size.width} x {scene.size.height}px</div>
    </div>
  );
}
