'use client';

import { useRef, useState } from 'react';
import type { MapPlanCommand } from '../model/mapPlanReducer';
import type { MapPlanV2, MapPlanV2Issue, Point } from '../model/mapPlanSchema';
import styles from '../CreateMapWorkbench.module.css';

export type MapPlanSelection =
  | { kind: 'region' | 'path' | 'placement'; id: string }
  | null;

export type MapViewport = { zoom: number; panX: number; panY: number };

type PlanReviewCanvasProps = {
  plan: MapPlanV2;
  selection: MapPlanSelection;
  issues: MapPlanV2Issue[];
  viewport: MapViewport;
  onCommand: (command: MapPlanCommand) => void;
  onSelectionChange: (selection: MapPlanSelection) => void;
};

export type PlanDragTarget = {
  selection: Exclude<MapPlanSelection, null>;
  start: Point;
  vertexIndex?: number;
};

export function commandForPlanDrag(
  plan: MapPlanV2,
  drag: PlanDragTarget,
  end: Point
): MapPlanCommand | null {
  const delta = { x: end.x - drag.start.x, y: end.y - drag.start.y };
  if (delta.x === 0 && delta.y === 0) return null;

  if (drag.selection.kind === 'region') {
    const region = plan.background.regions.find((item) => item.id === drag.selection.id);
    if (!region) return null;
    const points = region.points.map((point, index) => (
      drag.vertexIndex === undefined || drag.vertexIndex === index
        ? { x: point.x + delta.x, y: point.y + delta.y }
        : point
    ));
    return { type: 'region/update', region: { ...region, points } };
  }

  if (drag.selection.kind === 'path') {
    const path = plan.background.paths.find((item) => item.id === drag.selection.id);
    if (!path) return null;
    const points = path.points.map((point, index) => (
      drag.vertexIndex === undefined || drag.vertexIndex === index
        ? { x: point.x + delta.x, y: point.y + delta.y }
        : point
    ));
    return { type: 'path/update', path: { ...path, points } };
  }

  const placement = plan.obstaclePlacements.find((item) => item.id === drag.selection.id);
  if (!placement) return null;
  return {
    type: 'placement/move',
    id: placement.id,
    position: {
      x: placement.position.x + delta.x,
      y: placement.position.y + delta.y,
    },
  };
}

export function PlanReviewCanvas({
  plan,
  selection,
  issues,
  viewport,
  onCommand,
  onSelectionChange,
}: PlanReviewCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<PlanDragTarget | null>(null);
  const [dragPoint, setDragPoint] = useState<Point | null>(null);
  const invalidIds = new Set(issues.flatMap((issue) => {
    const section = issue.path[1];
    const index = issue.path[2];
    if (section === 'regions' && typeof index === 'number') return [plan.background.regions[index]?.id];
    if (section === 'paths' && typeof index === 'number') return [plan.background.paths[index]?.id];
    if (issue.path[0] === 'obstaclePlacements' && typeof issue.path[1] === 'number') {
      return [plan.obstaclePlacements[issue.path[1]]?.id];
    }
    return [];
  }).filter(Boolean) as string[]);

  const toMapPoint = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * plan.map.width,
      y: ((event.clientY - bounds.top) / bounds.height) * plan.map.height,
    };
  };
  const startDrag = (
    event: React.PointerEvent<SVGElement>,
    next: Exclude<MapPlanSelection, null>,
    vertexIndex?: number
  ) => {
    event.stopPropagation();
    onSelectionChange(next);
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    const bounds = svg.getBoundingClientRect();
    const start = {
      x: ((event.clientX - bounds.left) / bounds.width) * plan.map.width,
      y: ((event.clientY - bounds.top) / bounds.height) * plan.map.height,
    };
    setDrag({ selection: next, start, vertexIndex });
    setDragPoint(start);
  };
  const finishDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const end = toMapPoint(event);
    const command = commandForPlanDrag(plan, drag, end);
    if (command) onCommand(command);
    setDrag(null);
    setDragPoint(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const colorForTerrain = (key: string) => {
    const index = plan.terrains.findIndex((terrain) => terrain.assetKey === key);
    return plan.background.palette[Math.max(0, index) % plan.background.palette.length] ?? '#71856a';
  };

  return (
    <div className={styles.planCanvasViewport} data-mode="plan-review">
      <svg
        ref={svgRef}
        className={styles.planCanvas}
        viewBox={`0 0 ${plan.map.width} ${plan.map.height}`}
        aria-label="Map plan structure canvas"
        style={{ transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})` }}
        onPointerDown={() => onSelectionChange(null)}
        onPointerMove={(event) => drag && setDragPoint(toMapPoint(event))}
        onPointerUp={finishDrag}
        onPointerCancel={() => { setDrag(null); setDragPoint(null); }}
      >
        <rect width={plan.map.width} height={plan.map.height} fill={colorForTerrain(plan.background.baseTerrainKey)} />
        {plan.background.regions.map((region) => (
          <g
            key={region.id}
            data-plan-kind="region"
            data-plan-id={region.id}
            data-selected={selection?.kind === 'region' && selection.id === region.id || undefined}
            data-invalid={invalidIds.has(region.id) || undefined}
          >
            <polygon
              points={region.points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill={colorForTerrain(region.terrainKey)}
              fillOpacity={0.88}
              stroke={invalidIds.has(region.id) ? '#c63b32' : selection?.kind === 'region' && selection.id === region.id ? '#0874c9' : '#ffffff'}
              strokeWidth={selection?.kind === 'region' && selection.id === region.id ? 4 : 2}
              onPointerDown={(event) => startDrag(event, { kind: 'region', id: region.id })}
            />
            {selection?.kind === 'region' && selection.id === region.id ? region.points.map((point, index) => (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r={5}
                className={styles.planHandle}
                data-vertex-index={index}
                onPointerDown={(event) => startDrag(event, { kind: 'region', id: region.id }, index)}
              />
            )) : null}
          </g>
        ))}
        {plan.background.paths.map((path) => (
          <g
            key={path.id}
            data-plan-kind="path"
            data-plan-id={path.id}
            data-selected={selection?.kind === 'path' && selection.id === path.id || undefined}
            data-invalid={invalidIds.has(path.id) || undefined}
          >
            <polyline
              points={path.points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={invalidIds.has(path.id) ? '#c63b32' : path.kind === 'river' ? '#2d75a8' : '#9c7952'}
              strokeWidth={path.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              onPointerDown={(event) => startDrag(event, { kind: 'path', id: path.id })}
            />
            {selection?.kind === 'path' && selection.id === path.id ? path.points.map((point, index) => (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r={5}
                className={styles.planHandle}
                data-vertex-index={index}
                onPointerDown={(event) => startDrag(event, { kind: 'path', id: path.id }, index)}
              />
            )) : null}
          </g>
        ))}
        {plan.obstaclePlacements.map((placement) => {
          const asset = plan.obstacleAssets.find((item) => item.assetKey === placement.assetKey);
          const width = (asset?.size.width ?? 32) * placement.scale;
          const height = (asset?.size.height ?? 32) * placement.scale;
          const selected = selection?.kind === 'placement' && selection.id === placement.id;
          return (
            <rect
              key={placement.id}
              data-plan-kind="placement"
              data-plan-id={placement.id}
              data-invalid={invalidIds.has(placement.id) || undefined}
              x={placement.position.x - width / 2}
              y={placement.position.y - height}
              width={width}
              height={height}
              rx={2}
              fill="#324b42"
              fillOpacity={0.76}
              stroke={invalidIds.has(placement.id) ? '#c63b32' : selected ? '#0874c9' : '#ffffff'}
              strokeWidth={selected ? 4 : 2}
              onPointerDown={(event) => startDrag(event, { kind: 'placement', id: placement.id })}
            />
          );
        })}
        {drag && dragPoint ? <circle cx={dragPoint.x} cy={dragPoint.y} r={6} className={styles.dragIndicator} /> : null}
      </svg>
      <div className={styles.canvasCoordinates}>Plan Review · {plan.map.width} x {plan.map.height}px</div>
    </div>
  );
}
