# Create Map Drag Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make objects and obstacles follow the pointer during dragging and keep newly drawn circle centers aligned with the raw pointer-down location.

**Architecture:** Add a pure interaction model that derives transient preview scenes and final editor commands from an immutable gesture snapshot. `MapCanvas` will keep this interaction state locally, render the derived scene during movement, and dispatch one durable command only on pointer up.

**Tech Stack:** React 19, TypeScript 5.9, HTML Canvas 2D, Jest 30, ts-jest

## Global Constraints

- Pointer hit testing and gesture origins use unsnapped map coordinates.
- Snap quantizes gesture deltas, never the pointer-down origin.
- Pointer movement changes transient preview state only.
- Pointer up emits at most one existing editor command; pointer cancel emits none.
- Persisted `MapScene`, `MapPlan`, and PixelLab contracts do not change.
- Existing dirty-worktree changes and retained real map data must remain intact.

---

## File Structure

- Create `src/features/create-map/model/mapInteraction.ts`: pure gesture types, geometry derivation, preview-scene derivation, and final-command derivation.
- Create `tests/unit/create-map/map-interaction.test.ts`: test object/obstacle translation, Snap behavior, circle/rectangle origins, previews, and final commands.
- Modify `src/features/create-map/components/MapCanvas.tsx`: replace release-only refs with transient interaction state and handle pointer cancellation.
- Modify `tests/unit/create-map/workbench-wiring.test.tsx`: require the Canvas pointer-cancel lifecycle and interaction preview wiring.

### Task 1: Pure Gesture Geometry And Preview Model

**Files:**
- Create: `src/features/create-map/model/mapInteraction.ts`
- Create: `tests/unit/create-map/map-interaction.test.ts`

**Interfaces:**
- Consumes: `Point` and `Obstacle` from `mapPlanSchema`, `MapScene` and `ObjectInstance` from `mapSceneSchema`, and `EditorCommand` from `mapSceneReducer`.
- Produces: `MapInteraction`, `interactionDelta(start, current, gridSize)`, `previewInteraction(scene, interaction, current, gridSize)`, and `commandForInteraction(interaction, current, gridSize)`.

- [ ] **Step 1: Write failing translation and Snap tests**

Create `tests/unit/create-map/map-interaction.test.ts` with tests that assert raw pointer deltas preserve the original object offset and snapped deltas preserve the entity's grid-relative offset:

```ts
import { describe, expect, it } from '@jest/globals';
import {
  commandForInteraction,
  interactionDelta,
  previewInteraction,
  type MapInteraction,
} from '@/features/create-map/model/mapInteraction';
import { makeValidMapScene } from './fixtures';

describe('Create Map pointer interactions', () => {
  it('moves an object by the pointer delta without replacing its anchor with the pointer', () => {
    const scene = makeValidMapScene();
    const object = scene.objects[0];
    const interaction: MapInteraction = {
      kind: 'object-drag',
      object,
      start: { x: 70, y: 55 },
    };

    const preview = previewInteraction(scene, interaction, { x: 90, y: 85 }, null);
    expect(preview.objects[0].position).toEqual({ x: 116, y: 110 });
    expect(commandForInteraction(interaction, { x: 90, y: 85 }, null)).toEqual({
      type: 'object/move',
      id: object.id,
      position: { x: 116, y: 110 },
    });
    expect(scene.objects[0].position).toEqual({ x: 96, y: 80 });
  });

  it('snaps the drag delta without snapping the grab point or original entity offset', () => {
    expect(interactionDelta({ x: 70, y: 55 }, { x: 91, y: 84 }, 32)).toEqual({ x: 32, y: 32 });
    expect(interactionDelta({ x: 70, y: 55 }, { x: 91, y: 84 }, null)).toEqual({ x: 21, y: 29 });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/create-map/map-interaction.test.ts
```

Expected: FAIL because `mapInteraction.ts` does not exist.

- [ ] **Step 3: Add failing obstacle and shape-creation tests**

Extend the same test file:

```ts
it.each(['rectangle', 'circle', 'polygon'] as const)('translates a %s obstacle in the preview and final command', (shape) => {
  const scene = makeValidMapScene();
  const obstacle = scene.obstacles.find((candidate) => candidate.shape === shape)!;
  const interaction: MapInteraction = { kind: 'obstacle-drag', obstacle, start: { x: 10, y: 20 } };
  const command = commandForInteraction(interaction, { x: 26, y: 44 }, null);
  const preview = previewInteraction(scene, interaction, { x: 26, y: 44 }, null);

  expect(command).toEqual({
    type: 'obstacle/update',
    obstacle: preview.obstacles.find((candidate) => candidate.id === obstacle.id),
  });
});

it('keeps a circle centered on the raw pointer-down point when Snap is enabled', () => {
  const scene = makeValidMapScene();
  const interaction: MapInteraction = {
    kind: 'circle-draw',
    id: 'obstacle-4',
    start: { x: 45, y: 61 },
  };

  const preview = previewInteraction(scene, interaction, { x: 78, y: 94 }, 32);
  expect(preview.obstacles.at(-1)).toEqual({
    id: 'obstacle-4',
    shape: 'circle',
    cx: 45,
    cy: 61,
    radius: Math.hypot(32, 32),
  });
});

it('uses the same rectangle geometry for preview and commit and discards zero-size shapes', () => {
  const scene = makeValidMapScene();
  const interaction: MapInteraction = {
    kind: 'rectangle-draw',
    id: 'obstacle-4',
    start: { x: 45, y: 61 },
  };
  const preview = previewInteraction(scene, interaction, { x: 80, y: 92 }, null);

  expect(commandForInteraction(interaction, { x: 80, y: 92 }, null)).toEqual({
    type: 'obstacle/add',
    obstacle: preview.obstacles.at(-1),
  });
  expect(commandForInteraction(interaction, interaction.start, null)).toBeNull();
  expect(commandForInteraction(interaction, { x: interaction.start.x, y: 92 }, null)).toBeNull();
});
```

- [ ] **Step 4: Implement the pure interaction model**

Create `src/features/create-map/model/mapInteraction.ts`:

```ts
import type { Obstacle, Point } from './mapPlanSchema';
import type { MapScene, ObjectInstance } from './mapSceneSchema';
import type { EditorCommand } from './mapSceneReducer';
import { snapPoint } from './coordinates';

export type MapInteraction =
  | { kind: 'object-drag'; object: ObjectInstance; start: Point }
  | { kind: 'obstacle-drag'; obstacle: Obstacle; start: Point }
  | { kind: 'rectangle-draw'; id: string; start: Point }
  | { kind: 'circle-draw'; id: string; start: Point };

export function interactionDelta(start: Point, current: Point, gridSize: number | null): Point {
  const delta = { x: current.x - start.x, y: current.y - start.y };
  return gridSize === null ? delta : snapPoint(delta, gridSize);
}

function translateObstacle(obstacle: Obstacle, delta: Point): Obstacle {
  if (obstacle.shape === 'rectangle') {
    return { ...obstacle, x: obstacle.x + delta.x, y: obstacle.y + delta.y };
  }
  if (obstacle.shape === 'circle') {
    return { ...obstacle, cx: obstacle.cx + delta.x, cy: obstacle.cy + delta.y };
  }
  return {
    ...obstacle,
    points: obstacle.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
  };
}

function createdObstacle(
  interaction: Extract<MapInteraction, { kind: 'rectangle-draw' | 'circle-draw' }>,
  current: Point,
  gridSize: number | null
): Obstacle | null {
  const delta = interactionDelta(interaction.start, current, gridSize);
  if (interaction.kind === 'rectangle-draw') {
    if (delta.x === 0 || delta.y === 0) return null;
    return {
      id: interaction.id,
      shape: 'rectangle',
      x: interaction.start.x + Math.min(0, delta.x),
      y: interaction.start.y + Math.min(0, delta.y),
      width: Math.abs(delta.x),
      height: Math.abs(delta.y),
    };
  }
  if (delta.x === 0 && delta.y === 0) return null;
  return {
    id: interaction.id,
    shape: 'circle',
    cx: interaction.start.x,
    cy: interaction.start.y,
    radius: Math.hypot(delta.x, delta.y),
  };
}

export function commandForInteraction(
  interaction: MapInteraction,
  current: Point,
  gridSize: number | null
): EditorCommand | null {
  const delta = interactionDelta(interaction.start, current, gridSize);
  if (interaction.kind === 'object-drag') {
    if (delta.x === 0 && delta.y === 0) return null;
    return {
      type: 'object/move',
      id: interaction.object.id,
      position: {
        x: interaction.object.position.x + delta.x,
        y: interaction.object.position.y + delta.y,
      },
    };
  }
  if (interaction.kind === 'obstacle-drag') {
    if (delta.x === 0 && delta.y === 0) return null;
    return { type: 'obstacle/update', obstacle: translateObstacle(interaction.obstacle, delta) };
  }
  const obstacle = createdObstacle(interaction, current, gridSize);
  return obstacle ? { type: 'obstacle/add', obstacle } : null;
}

export function previewInteraction(
  scene: MapScene,
  interaction: MapInteraction | null,
  current: Point | null,
  gridSize: number | null
): MapScene {
  if (!interaction || !current) return scene;
  const command = commandForInteraction(interaction, current, gridSize);
  if (!command) return scene;
  if (command.type === 'object/move') {
    return {
      ...scene,
      objects: scene.objects.map((object) => object.id === command.id
        ? { ...object, position: command.position }
        : object),
    };
  }
  if (command.type === 'obstacle/update') {
    return {
      ...scene,
      obstacles: scene.obstacles.map((obstacle) => obstacle.id === command.obstacle.id
        ? command.obstacle
        : obstacle),
    };
  }
  if (command.type === 'obstacle/add') {
    return { ...scene, obstacles: [...scene.obstacles, command.obstacle] };
  }
  return scene;
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx jest --runInBand tests/unit/create-map/map-interaction.test.ts tests/unit/create-map/coordinates.test.ts tests/unit/create-map/map-scene-reducer.test.ts
```

Expected: 3 suites pass with no errors.

- [ ] **Step 6: Commit the pure interaction model**

```bash
git add src/features/create-map/model/mapInteraction.ts tests/unit/create-map/map-interaction.test.ts
git commit -m "fix: model create map pointer gestures"
```

### Task 2: Canvas Live Preview And Pointer Lifecycle

**Files:**
- Modify: `src/features/create-map/components/MapCanvas.tsx:212-369`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`

**Interfaces:**
- Consumes: `MapInteraction`, `previewInteraction`, and `commandForInteraction` from Task 1.
- Produces: live object/obstacle/shape previews, one-command pointer-up commits, and no-command pointer cancellation.

- [ ] **Step 1: Add a failing Canvas lifecycle wiring test**

Extend `tests/unit/create-map/workbench-wiring.test.tsx`:

```ts
it('wires transient pointer previews, one final command, and pointer cancellation', () => {
  const canvas = readFileSync(
    path.join(process.cwd(), 'src/features/create-map/components/MapCanvas.tsx'),
    'utf8'
  );

  expect(canvas).toContain('previewInteraction(');
  expect(canvas).toContain('commandForInteraction(');
  expect(canvas).toContain('onPointerCancel={handlePointerCancel}');
  expect(canvas).toMatch(/setInteraction\(null\)[\s\S]*setInteractionPoint\(null\)/);
});
```

- [ ] **Step 2: Run the wiring test and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/create-map/workbench-wiring.test.tsx
```

Expected: FAIL because `MapCanvas` has no preview interaction or pointer-cancel handler.

- [ ] **Step 3: Replace snapped pointer input with explicit raw and gesture coordinates**

In `MapCanvas.tsx`, add `useMemo` to the React import, add `snapPoint` to the coordinate import, and import the Task 1 interface:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { screenToMap, snapPoint, type MapViewport } from '../model/coordinates';
import {
  commandForInteraction,
  previewInteraction,
  type MapInteraction,
} from '../model/mapInteraction';
```

Replace the release-only object and obstacle refs with transient state:

```ts
const [interaction, setInteraction] = useState<MapInteraction | null>(null);
const [interactionPoint, setInteractionPoint] = useState<Point | null>(null);
```

Replace `toMapPoint` with an unsnapped conversion and keep a separate helper only for polygon and mask tools:

```ts
const toRawMapPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return screenToMap({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport);
}, [viewport]);

const snapMapPoint = useCallback((point: Point) => {
  if (!snapToGrid) return point;
  return snapPoint(point, scene.size.tileSize);
}, [scene.size.tileSize, snapToGrid]);

const interactionGridSize = snapToGrid ? scene.size.tileSize : null;
```

- [ ] **Step 4: Start interactions without moving the raw origin**

Change selection to return the selected entity and start an immutable gesture snapshot:

```ts
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
```

In `handlePointerDown`, use `toRawMapPoint(event)`. Start rectangle and circle gestures with the raw point and allocate the obstacle ID immediately. Keep polygon and mask input using `snapMapPoint(rawPoint)`:

```ts
if (tool === 'select') startSelectionInteraction(rawPoint);
else if (tool === 'rectangle' || tool === 'circle') {
  const id = obstacleId(obstacleSequenceRef.current++);
  setInteraction({ kind: tool === 'rectangle' ? 'rectangle-draw' : 'circle-draw', id, start: rawPoint });
  setInteractionPoint(rawPoint);
} else if (tool === 'polygon') {
  setPolygonPoints((current) => [...current, snapMapPoint(rawPoint)]);
} else if (tool === 'mask') {
  onMaskPaint(snapMapPoint(rawPoint));
}
```

- [ ] **Step 5: Render movement previews and commit once**

Derive a preview scene before the render effect:

```ts
const renderedScene = useMemo(
  () => previewInteraction(scene, interaction, interactionPoint, interactionGridSize),
  [interaction, interactionGridSize, interactionPoint, scene]
);
```

Pass `renderedScene` to `renderMapScene`. During captured pointer movement, update only `interactionPoint`. On pointer up, derive and dispatch one command, select a newly added obstacle, then clear state:

```ts
const clearInteraction = () => {
  setInteraction(null);
  setInteractionPoint(null);
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

const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
  if (interaction) {
    const command = commandForInteraction(
      interaction,
      toRawMapPoint(event),
      interactionGridSize
    );
    if (command) {
      onCommand(command);
      if (command.type === 'obstacle/add') {
        onSelectionChange({ kind: 'obstacle', id: command.obstacle.id });
      }
    }
  }
  dragStartRef.current = null;
  handStartRef.current = null;
  clearInteraction();
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
};

const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
  dragStartRef.current = null;
  handStartRef.current = null;
  clearInteraction();
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
};
```

Attach `onPointerCancel={handlePointerCancel}` to the canvas. Remove the old `objectDragIdRef`, `obstacleDragRef`, release-only translation branches, and local `translateObstacle` function.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
npx jest --runInBand tests/unit/create-map/map-interaction.test.ts tests/unit/create-map/canvas-renderer.test.ts tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/map-scene-reducer.test.ts tests/unit/create-map/coordinates.test.ts
npm run typecheck
```

Expected: 5 Jest suites pass and TypeScript exits with code 0.

- [ ] **Step 7: Commit the Canvas integration**

```bash
git add src/features/create-map/components/MapCanvas.tsx tests/unit/create-map/workbench-wiring.test.tsx
git commit -m "fix: make create map gestures track the pointer"
```

### Task 3: Browser Regression At Localhost 3000

**Files:**
- Modify only if verification exposes a failing behavior in Task 1 or Task 2 files.
- Retain: all existing database rows, generated assets, screenshots, and storage objects.

**Interfaces:**
- Consumes: the completed Canvas interaction behavior from Task 2.
- Produces: runtime evidence that pointer coordinates and preview rendering agree under pan, zoom, and Snap.

- [ ] **Step 1: Confirm the existing dev server**

Run:

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:3000/b8bbc964-c463-4044-93fc-6428fd37534c
```

Expected: `200`.

- [ ] **Step 2: Verify gestures in the authenticated browser session**

At `http://localhost:3000/b8bbc964-c463-4044-93fc-6428fd37534c`:

1. Select an object away from its anchor, drag it, and confirm it follows without jumping.
2. Drag rectangle, circle, and polygon obstacles and confirm each follows continuously.
3. Enable Snap, draw a circle from a point between grid lines, and confirm its center remains at the pressed point.
4. Disable Snap and repeat, confirming the edge follows continuously.
5. Dispatch a `pointercancel` event during an automated gesture and confirm no scene change is committed.
6. Complete one drag, click Undo once, and confirm the whole gesture is reverted.

Expected: all six checks pass; no new console error appears.

- [ ] **Step 3: Run the full Create Map regression set**

Run:

```bash
npx jest --runInBand tests/unit/create-map
npm run typecheck
git diff --check
```

Expected: all Create Map suites pass, typecheck exits 0, and `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Capture and retain evidence**

Save a screenshot after drawing a circle centered at the pointer-down location as:

```text
test-results/create-map-drag-interaction-fixed.png
```

Do not delete or overwrite prior Create Map evidence or generated records.
