import { describe, expect, it } from '@jest/globals';
import {
  MAX_EDITOR_HISTORY,
  createEditorState,
  reduceEditorCommand,
  redo,
  selectEditorEntity,
  undo,
} from '@/features/create-map/model/mapSceneReducer';
import { makeValidMapScene, makeValidMapSceneV2 } from './fixtures';

describe('create map editor reducer', () => {
  it('moves one object, preserves others, and supports undo/redo', () => {
    const initial = createEditorState(makeValidMapScene());
    const moved = reduceEditorCommand(initial, {
      type: 'object/move',
      id: 'tree-1',
      position: { x: 96, y: 64 },
    });

    expect(moved.present.objects.find((object) => object.id === 'tree-1')?.position).toEqual({ x: 96, y: 64 });
    expect(initial.present.objects.find((object) => object.id === 'tree-1')?.position).toEqual({ x: 96, y: 80 });
    expect(undo(moved).present).toEqual(initial.present);
    expect(redo(undo(moved)).present).toEqual(moved.present);
  });

  it('transforms objects and edits every obstacle shape immutably', () => {
    let state = createEditorState(makeValidMapScene());
    state = reduceEditorCommand(state, { type: 'object/transform', id: 'tree-1', scale: 1.5, rotation: 90 });
    state = reduceEditorCommand(state, {
      type: 'obstacle/update',
      obstacle: { id: 'stall-block', shape: 'rectangle', x: 144, y: 80, width: 80, height: 64 },
    });
    state = reduceEditorCommand(state, {
      type: 'obstacle/update',
      obstacle: { id: 'fountain-block', shape: 'circle', cx: 336, cy: 192, radius: 32 },
    });
    state = reduceEditorCommand(state, {
      type: 'obstacle/update',
      obstacle: {
        id: 'garden-block',
        shape: 'polygon',
        points: [{ x: 352, y: 64 }, { x: 424, y: 80 }, { x: 400, y: 144 }],
      },
    });
    state = reduceEditorCommand(state, {
      type: 'obstacle/add',
      obstacle: { id: 'gate-block', shape: 'rectangle', x: 32, y: 32, width: 16, height: 16 },
    });
    state = reduceEditorCommand(state, {
      type: 'obstacle/add',
      obstacle: { id: 'well-block', shape: 'circle', cx: 64, cy: 64, radius: 12 },
    });
    state = reduceEditorCommand(state, {
      type: 'obstacle/add',
      obstacle: {
        id: 'flower-bed-block',
        shape: 'polygon',
        points: [{ x: 16, y: 16 }, { x: 48, y: 16 }, { x: 32, y: 48 }],
      },
    });

    expect(state.present.objects[0]).toMatchObject({ scale: 1.5, rotation: 90 });
    expect(state.present.obstacles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'stall-block', x: 144, width: 80 }),
      expect.objectContaining({ id: 'fountain-block', cx: 336, radius: 32 }),
      expect.objectContaining({ id: 'garden-block', points: [{ x: 352, y: 64 }, { x: 424, y: 80 }, { x: 400, y: 144 }] }),
      expect.objectContaining({ id: 'gate-block' }),
      expect.objectContaining({ id: 'well-block' }),
      expect.objectContaining({ id: 'flower-bed-block' }),
    ]));

    state = reduceEditorCommand(state, { type: 'obstacle/delete', id: 'stall-block' });
    state = reduceEditorCommand(state, { type: 'obstacle/delete', id: 'fountain-block' });
    state = reduceEditorCommand(state, { type: 'obstacle/delete', id: 'garden-block' });
    state = reduceEditorCommand(state, { type: 'obstacle/delete', id: 'gate-block' });
    state = reduceEditorCommand(state, { type: 'obstacle/delete', id: 'well-block' });
    state = reduceEditorCommand(state, { type: 'obstacle/delete', id: 'flower-bed-block' });
    expect(state.present.obstacles).toEqual([]);
  });

  it('reorders layers, toggles visibility, and truncates redo history after a new command', () => {
    let state = createEditorState(makeValidMapScene());
    state = reduceEditorCommand(state, { type: 'layer/reorder', layerId: 'overlay', toIndex: 0 });
    state = reduceEditorCommand(state, { type: 'layer/visibility', layerId: 'objects', visible: false });

    expect(state.present.layers.map((layer) => layer.id)).toEqual(['overlay', 'terrain', 'objects']);
    expect(state.present.layers.find((layer) => layer.id === 'objects')?.visible).toBe(false);

    const undone = undo(state);
    const replaced = reduceEditorCommand(undone, { type: 'layer/visibility', layerId: 'terrain', visible: false });
    expect(replaced.future).toEqual([]);
  });

  it('caps history and keeps selection outside durable scene state', () => {
    let state = createEditorState(makeValidMapScene());
    for (let x = 0; x <= MAX_EDITOR_HISTORY; x += 1) {
      state = reduceEditorCommand(state, { type: 'object/move', id: 'tree-1', position: { x, y: 80 } });
    }

    expect(state.past).toHaveLength(MAX_EDITOR_HISTORY);
    expect(selectEditorEntity('object', 'tree-1')).toEqual({ kind: 'object', id: 'tree-1' });
    expect(state.present).not.toHaveProperty('selection');
    expect(state.past.every((scene) => !('selection' in scene))).toBe(true);
  });
});

describe('MapScene V2 editor reducer', () => {
  it('moves, transforms, edits collision, and changes z-order as one bound entity', () => {
    let state = createEditorState(makeValidMapSceneV2());
    state = reduceEditorCommand(state, { type: 'entity/move', id: 'rock-1', position: { x: 80, y: 48 } });
    state = reduceEditorCommand(state, { type: 'entity/transform', id: 'rock-1', scale: 1.5, rotation: 90 });
    state = reduceEditorCommand(state, {
      type: 'entity/collision',
      id: 'rock-1',
      collision: { shape: 'rectangle', x: -8, y: -16, width: 16, height: 16 },
    });
    state = reduceEditorCommand(state, { type: 'entity/z-order', id: 'rock-1', zIndex: 20 });

    expect(state.present.obstacleEntities[0]).toEqual(expect.objectContaining({
      position: { x: 80, y: 48 },
      scale: 1.5,
      rotation: 90,
      zIndex: 20,
      collision: { shape: 'rectangle', x: -8, y: -16, width: 16, height: 16 },
    }));
    expect(undo(state).present.obstacleEntities[0].zIndex).toBe(10);
    expect(redo(undo(state)).present.obstacleEntities[0].zIndex).toBe(20);
  });

  it('duplicates complete entities with a new id and independent local collision', () => {
    const initial = createEditorState(makeValidMapSceneV2());
    const duplicated = reduceEditorCommand(initial, {
      type: 'entity/duplicate',
      id: 'rock-1',
      newId: 'rock-2',
      offset: { x: 16, y: 8 },
    });
    const duplicate = duplicated.present.obstacleEntities[1];

    expect(duplicate).toEqual(expect.objectContaining({
      id: 'rock-2',
      assetKey: 'mossy-rock',
      position: { x: 112, y: 72 },
      collision: initial.present.obstacleEntities[0].collision,
    }));
    expect(duplicate.collision).not.toBe(initial.present.obstacleEntities[0].collision);
  });

  it('keeps Plan and Scene undo histories independent', () => {
    const initialScene = createEditorState(makeValidMapSceneV2());
    const movedScene = reduceEditorCommand(initialScene, {
      type: 'entity/move',
      id: 'rock-1',
      position: { x: 80, y: 48 },
    });

    expect(movedScene.past).toHaveLength(1);
    expect(initialScene.past).toHaveLength(0);
  });
});
