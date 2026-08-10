import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapPlanInspector } from '@/features/create-map/components/MapPlanInspector';
import {
  commandForPlanDrag,
  PlanReviewCanvas,
} from '@/features/create-map/components/PlanReviewCanvas';
import {
  createMapPlanEditorState,
  reduceMapPlanCommand,
} from '@/features/create-map/model/mapPlanReducer';
import { makeValidMapPlanV2 } from './fixtures';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

const viewport = { zoom: 1, panX: 0, panY: 0 };

describe('PlanReviewCanvas', () => {
  it('renders schematic regions, paths, placements, selected handles, and validation highlights', () => {
    const plan = makeValidMapPlanV2();
    const markup = renderToStaticMarkup(
      <PlanReviewCanvas
        plan={plan}
        selection={{ kind: 'region', id: 'earth-clearing' }}
        issues={[{
          code: 'outside_map',
          path: ['background', 'regions', 0, 'points', 0],
          message: 'Region point is outside the map',
        }]}
        viewport={viewport}
        onCommand={() => undefined}
        onSelectionChange={() => undefined}
      />
    );

    expect(markup).toContain('data-plan-kind="region"');
    expect(markup).toContain('data-plan-kind="path"');
    expect(markup).toContain('data-plan-kind="placement"');
    expect(markup).toContain('data-selected="true"');
    expect(markup).toContain('data-invalid="true"');
    expect(markup).toContain('data-vertex-index="0"');
    expect(markup).toContain('stroke-width="32"');
  });

  it('builds one final reducer command for a drag and no command for zero movement', () => {
    const plan = makeValidMapPlanV2();
    const drag = {
      selection: { kind: 'placement' as const, id: 'rock-1' },
      start: { x: 96, y: 64 },
    };
    const command = commandForPlanDrag(plan, drag, { x: 112, y: 80 });

    expect(command).toEqual({
      type: 'placement/move',
      id: 'rock-1',
      position: { x: 112, y: 80 },
    });
    expect(commandForPlanDrag(plan, drag, drag.start)).toBeNull();

    const state = reduceMapPlanCommand(createMapPlanEditorState(plan), command!);
    expect(state.past).toHaveLength(1);
    expect(state.present.obstaclePlacements[0].position).toEqual({ x: 112, y: 80 });
  });

  it('moves only a selected path vertex when a handle is dragged', () => {
    const plan = makeValidMapPlanV2();
    const command = commandForPlanDrag(plan, {
      selection: { kind: 'path', id: 'market-road' },
      start: { ...plan.background.paths[0].points[1] },
      vertexIndex: 1,
    }, { x: 64, y: 32 });

    expect(command?.type).toBe('path/update');
    if (command?.type !== 'path/update') throw new Error('Expected path command');
    expect(command.path.points).toEqual([
      { x: 16, y: 16 },
      { x: 64, y: 32 },
      { x: 48, y: 80 },
    ]);
  });

  it('associates field errors and keeps the selected path prompt editable', () => {
    const plan = makeValidMapPlanV2();
    const widthMarkup = renderToStaticMarkup(
      <MapPlanInspector
        plan={plan}
        selection={null}
        issues={[{
          code: 'invalid_dimension',
          path: ['map', 'width'],
          message: 'Map width must be divisible by tile size',
        }]}
        onCommand={() => undefined}
      />
    );
    const pathMarkup = renderToStaticMarkup(
      <MapPlanInspector
        plan={plan}
        selection={{ kind: 'path', id: 'market-road' }}
        issues={[]}
        onCommand={() => undefined}
      />
    );

    expect(widthMarkup).toContain('aria-invalid="true"');
    expect(widthMarkup).toContain('aria-describedby="map-width-error"');
    expect(widthMarkup).toContain('id="map-width-error"');
    expect(pathMarkup).toContain('Prompt');
    expect(pathMarkup).toContain('A narrow packed-earth road with complete directional connections.');
  });
});
