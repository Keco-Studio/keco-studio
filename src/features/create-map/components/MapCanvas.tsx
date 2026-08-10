'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '../model/mapPlanSchema';
import type { MapSceneV2, ObstacleEntity } from '../model/mapSceneSchema';
import type { EditorSelection, MapSceneV2Command } from '../model/mapSceneReducer';
import { screenToMap, type MapViewport } from '../model/coordinates';
import { transformLocalCollision } from '../model/obstacleCollision';
import {
  commandForInteraction,
  mapPointToEntityLocal,
  previewInteraction,
  type MapInteraction,
} from '../model/mapInteraction';
import type { MapTool } from './MapToolbar';
import styles from '../CreateMapWorkbench.module.css';

export type MapRenderAsset = {
  assetKey: string;
  kind: 'background' | 'obstacle';
  image?: CanvasImageSource;
  width: number;
  height: number;
};

export type MapRenderViewport = MapViewport & { devicePixelRatio: number };
export type MapRenderSelection = EditorSelection;

function entityLocalToMap(entity: ObstacleEntity, point: Point): Point {
  const radians = (entity.rotation * Math.PI) / 180;
  const scaledX = point.x * entity.scale;
  const scaledY = point.y * entity.scale;
  return {
    x: entity.position.x + scaledX * Math.cos(radians) - scaledY * Math.sin(radians),
    y: entity.position.y + scaledX * Math.sin(radians) + scaledY * Math.cos(radians),
  };
}

function drawCollision(
  context: CanvasRenderingContext2D,
  entity: ObstacleEntity,
  selected: boolean,
): void {
  const collision = transformLocalCollision(entity);
  context.beginPath();
  if (collision.shape === 'circle') {
    context.arc(collision.cx, collision.cy, collision.radius, 0, Math.PI * 2);
  } else {
    collision.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
  }
  context.fillStyle = selected ? 'rgba(11, 120, 208, 0.12)' : 'rgba(211, 77, 77, 0.13)';
  context.strokeStyle = selected ? '#0b78d0' : '#c94a4a';
  context.lineWidth = selected ? 2.5 : 1.5;
  context.fill();
  context.stroke();
}

function drawEntity(
  context: CanvasRenderingContext2D,
  entity: ObstacleEntity,
  asset: MapRenderAsset | undefined,
  selected: boolean,
): void {
  const width = asset?.width ?? Math.max(32, entity.groundAnchor.x * 2);
  const height = asset?.height ?? Math.max(32, entity.groundAnchor.y + 8);
  context.save();
  context.translate(entity.position.x, entity.position.y);
  context.rotate((entity.rotation * Math.PI) / 180);
  context.scale(entity.scale, entity.scale);
  if (asset?.image) {
    context.drawImage(asset.image, -entity.groundAnchor.x, -entity.groundAnchor.y, width, height);
  } else {
    context.fillStyle = '#52735b';
    context.fillRect(-entity.groundAnchor.x, -entity.groundAnchor.y, width, height);
  }
  if (selected) {
    context.strokeStyle = '#0b78d0';
    context.lineWidth = 2 / entity.scale;
    context.setLineDash([5 / entity.scale, 3 / entity.scale]);
    context.strokeRect(-entity.groundAnchor.x, -entity.groundAnchor.y, width, height);
    context.setLineDash([]);
  }
  context.restore();
}

export function renderMapScene(
  context: CanvasRenderingContext2D,
  scene: MapSceneV2,
  assets: ReadonlyMap<string, MapRenderAsset>,
  viewport: MapRenderViewport,
  selection: MapRenderSelection = null,
): void {
  const dpr = Math.max(1, viewport.devicePixelRatio || 1);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.setTransform(
    dpr * viewport.zoom,
    0,
    0,
    dpr * viewport.zoom,
    dpr * viewport.panX,
    dpr * viewport.panY,
  );
  context.fillStyle = '#e8ece5';
  context.fillRect(0, 0, scene.size.width, scene.size.height);

  const visibleLayers = new Set(scene.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  if (scene.background && visibleLayers.has('background')) {
    const background = assets.get(scene.background.assetKey);
    if (background?.image) {
      context.drawImage(background.image, 0, 0, scene.size.width, scene.size.height);
    }
  }

  if (visibleLayers.has('obstacles')) {
    [...scene.obstacleEntities]
      .sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id))
      .forEach((entity) => drawEntity(
        context,
        entity,
        assets.get(entity.assetKey),
        selection?.kind === 'entity' && selection.id === entity.id,
      ));
  }

  if (visibleLayers.has('collision')) {
    scene.obstacleEntities.forEach((entity) => drawCollision(
      context,
      entity,
      selection?.kind === 'entity' && selection.id === entity.id,
    ));
    const selected = selection?.kind === 'entity'
      ? scene.obstacleEntities.find((entity) => entity.id === selection.id)
      : undefined;
    if (selected?.collision.shape === 'polygon') {
      selected.collision.points.forEach((point) => {
        const world = entityLocalToMap(selected, point);
        context.beginPath();
        context.arc(world.x, world.y, 5 / viewport.zoom, 0, Math.PI * 2);
        context.fillStyle = '#ffffff';
        context.strokeStyle = '#0b78d0';
        context.lineWidth = 2 / viewport.zoom;
        context.fill();
        context.stroke();
      });
    }
  }
  context.restore();
}

export function entityContainsMapPoint(
  entity: ObstacleEntity,
  asset: MapRenderAsset | undefined,
  point: Point,
): boolean {
  const local = mapPointToEntityLocal(entity, point);
  const width = asset?.width ?? Math.max(32, entity.groundAnchor.x * 2);
  const height = asset?.height ?? Math.max(32, entity.groundAnchor.y + 8);
  return local.x >= -entity.groundAnchor.x
    && local.x <= width - entity.groundAnchor.x
    && local.y >= -entity.groundAnchor.y
    && local.y <= height - entity.groundAnchor.y;
}

type MapCanvasProps = {
  scene: MapSceneV2;
  assets: ReadonlyMap<string, MapRenderAsset>;
  tool: MapTool;
  viewport: MapViewport;
  snapToGrid: boolean;
  selection: EditorSelection;
  onCommand: (command: MapSceneV2Command) => void;
  onSelectionChange: (selection: EditorSelection) => void;
  onViewportChange: (viewport: MapViewport) => void;
};

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
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handStartRef = useRef<{ point: Point; viewport: MapViewport } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [interaction, setInteraction] = useState<MapInteraction | null>(null);
  const [interactionPoint, setInteractionPoint] = useState<Point | null>(null);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);

  const selectedEntity = selection?.kind === 'entity'
    ? scene.obstacleEntities.find((entity) => entity.id === selection.id) ?? null
    : null;
  const collisionVisible = scene.layers.some((layer) => layer.id === 'collision' && layer.visible);
  const interactionGridSize = snapToGrid ? scene.size.tileSize : null;
  const renderedScene = useMemo(
    () => previewInteraction(scene, interaction, interactionPoint, interactionGridSize),
    [interaction, interactionGridSize, interactionPoint, scene],
  );

  const toMapPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return screenToMap({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport);
  }, [viewport]);

  const currentInteractionPoint = useCallback((point: Point, active: MapInteraction): Point =>
    active.kind === 'entity-drag' ? point : mapPointToEntityLocal(active.entity, point), []);

  const finishPolygon = useCallback(() => {
    if (selectedEntity && polygonPoints.length >= 3) {
      onCommand({
        type: 'entity/collision',
        id: selectedEntity.id,
        collision: { shape: 'polygon', points: polygonPoints },
      });
    }
    setPolygonPoints([]);
  }, [onCommand, polygonPoints, selectedEntity]);

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
    renderMapScene(
      context,
      renderedScene,
      assets,
      { ...viewport, devicePixelRatio: window.devicePixelRatio || 1 },
      selection,
    );
    if (selectedEntity && polygonPoints.length > 0) {
      const dpr = window.devicePixelRatio || 1;
      context.save();
      context.setTransform(
        dpr * viewport.zoom, 0, 0, dpr * viewport.zoom,
        dpr * viewport.panX, dpr * viewport.panY,
      );
      context.beginPath();
      polygonPoints.forEach((point, index) => {
        const world = entityLocalToMap(selectedEntity, point);
        if (index === 0) context.moveTo(world.x, world.y);
        else context.lineTo(world.x, world.y);
      });
      context.strokeStyle = '#0b78d0';
      context.lineWidth = 2 / viewport.zoom;
      context.stroke();
      context.restore();
    }
  }, [assets, canvasSize, polygonPoints, renderedScene, selectedEntity, selection, viewport]);

  const startSelection = (point: Point) => {
    setPolygonPoints([]);
    clearInteraction();
    if (collisionVisible && selectedEntity?.collision.shape === 'polygon') {
      const vertexIndex = selectedEntity.collision.points.findIndex((vertex) => {
        const world = entityLocalToMap(selectedEntity, vertex);
        return Math.hypot(world.x - point.x, world.y - point.y) <= 8 / viewport.zoom;
      });
      if (vertexIndex >= 0) {
        setInteraction({ kind: 'collision-vertex-drag', entity: selectedEntity, vertexIndex });
        setInteractionPoint(mapPointToEntityLocal(selectedEntity, point));
        return;
      }
    }
    const obstacleLayerVisible = scene.layers.some((layer) => layer.id === 'obstacles' && layer.visible);
    const entity = obstacleLayerVisible
      ? [...scene.obstacleEntities]
          .sort((left, right) => right.zIndex - left.zIndex || right.id.localeCompare(left.id))
          .find((candidate) => entityContainsMapPoint(candidate, assets.get(candidate.assetKey), point))
      : undefined;
    onSelectionChange(entity ? { kind: 'entity', id: entity.id } : null);
    if (entity) {
      setInteraction({ kind: 'entity-drag', entity, start: point });
      setInteractionPoint(point);
    }
  };

  const clearInteraction = () => {
    handStartRef.current = null;
    setInteraction(null);
    setInteractionPoint(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toMapPoint(event);
    if (tool === 'hand') {
      handStartRef.current = { point: { x: event.clientX, y: event.clientY }, viewport };
      return;
    }
    if (tool === 'select') {
      startSelection(point);
      return;
    }
    if (!selectedEntity) return;
    const local = mapPointToEntityLocal(selectedEntity, point);
    if (tool === 'collision-rectangle' || tool === 'collision-circle') {
      setInteraction({
        kind: tool === 'collision-rectangle' ? 'collision-rectangle-draw' : 'collision-circle-draw',
        entity: selectedEntity,
        start: local,
      });
      setInteractionPoint(local);
    } else if (tool === 'collision-polygon') {
      setPolygonPoints((current) => [...current, local]);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (tool === 'hand' && handStartRef.current) {
      const start = handStartRef.current;
      onViewportChange({
        ...start.viewport,
        panX: start.viewport.panX + event.clientX - start.point.x,
        panY: start.viewport.panY + event.clientY - start.point.y,
      });
    } else if (interaction) {
      setInteractionPoint(currentInteractionPoint(toMapPoint(event), interaction));
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (interaction) {
      const point = currentInteractionPoint(toMapPoint(event), interaction);
      const command = commandForInteraction(interaction, point, interactionGridSize);
      if (command) onCommand(command);
    }
    clearInteraction();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    clearInteraction();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className={styles.canvasViewport} data-tool={tool}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        aria-label="Editable layered map canvas"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={() => tool === 'collision-polygon' && finishPolygon()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && tool === 'collision-polygon') finishPolygon();
          if (event.key === 'Escape') {
            setPolygonPoints([]);
            clearInteraction();
          }
        }}
      />
      <div className={styles.canvasCoordinates} aria-live="polite">
        {scene.size.width} x {scene.size.height}px
      </div>
    </div>
  );
}
