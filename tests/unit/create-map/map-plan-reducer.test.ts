import { describe, expect, it } from '@jest/globals';
import {
  createMapPlanEditorState,
  reduceMapPlanCommand,
  redoMapPlan,
  undoMapPlan,
} from '@/features/create-map/model/mapPlanReducer';
import { createEditorState, reduceEditorCommand } from '@/features/create-map/model/mapSceneReducer';
import { makeValidMapPlanV2, makeValidMapSceneV2 } from './fixtures';

describe('MapPlan V2 reducer', () => {
  it('edits region and path structure with undo and redo', () => {
    let state = createMapPlanEditorState(makeValidMapPlanV2());
    state = reduceMapPlanCommand(state, {
      type: 'region/update',
      region: {
        ...state.present.background.regions[0],
        points: [{ x: 64, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 96 }, { x: 64, y: 96 }],
      },
    });
    state = reduceMapPlanCommand(state, {
      type: 'path/update',
      path: { ...state.present.background.paths[0], width: 48, prompt: 'A wider packed-earth market road.' },
    });

    expect(state.present.background.regions[0].points[1].x).toBe(96);
    expect(state.present.background.paths[0]).toEqual(expect.objectContaining({ width: 48, prompt: expect.any(String) }));
    expect(redoMapPlan(undoMapPlan(state)).present).toEqual(state.present);
  });

  it('moves planned obstacles without writing Scene history', () => {
    const planState = reduceMapPlanCommand(createMapPlanEditorState(makeValidMapPlanV2()), {
      type: 'placement/move',
      id: 'rock-1',
      position: { x: 64, y: 64 },
    });
    const sceneState = createEditorState(makeValidMapSceneV2());

    expect(planState.present.obstaclePlacements[0].position).toEqual({ x: 64, y: 64 });
    expect(planState.past).toHaveLength(1);
    expect(sceneState.past).toHaveLength(0);

    const movedScene = reduceEditorCommand(sceneState, {
      type: 'entity/move',
      id: 'rock-1',
      position: { x: 80, y: 64 },
    });
    expect(movedScene.past).toHaveLength(1);
    expect(planState.present.obstaclePlacements[0].position).toEqual({ x: 64, y: 64 });
  });
});
