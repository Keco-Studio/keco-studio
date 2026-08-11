# Create Map Drag Interaction Design

## Goal

Make Create Map object and obstacle manipulation track the pointer continuously, preserve the point where an entity was grabbed, and make newly drawn circles begin exactly at the visible pointer position.

## Scope

This change covers:

- dragging movable objects with the Select tool;
- dragging rectangle, circle, and polygon obstacles with the Select tool;
- drawing rectangle and circle obstacles with a live preview;
- keeping one completed gesture as one undoable editor command;
- retaining the existing Snap control without letting it displace the pointer-down location.

It does not change polygon authoring, map panning, object rotation or scaling, persisted scene schemas, or PixelLab generation.

## Interaction Rules

Pointer coordinates are converted from screen space to map space before any other operation. Pointer hit testing and the initial grab point always use the unsnapped map coordinate.

When dragging an existing entity, the editor records an immutable gesture snapshot containing the original entity and the raw pointer-down position. Pointer movement produces a transient preview by applying the gesture delta to the original entity. The entity therefore keeps the exact point the user grabbed instead of moving its anchor or center beneath the cursor.

When Snap is enabled, the gesture delta is snapped to the tile grid. The raw grab point itself is never snapped. This lets an entity retain its existing grid-relative offset while moving in tile-sized increments. With Snap disabled, the raw delta is used.

Circle and rectangle drawing start at the exact raw pointer-down position. Their transient geometry follows the raw pointer while the gesture is active, so the preview remains under the cursor. Snap affects the size or end coordinate relative to that fixed origin; it does not move the origin. Zero-size shapes are discarded.

## State And Rendering

`MapCanvas` owns a transient interaction state for the active gesture. It contains only data needed to render the preview and is never written to the durable `MapScene` during pointer movement.

Rendering uses a derived preview scene:

- object drag replaces the selected object's position in memory;
- obstacle drag replaces the selected obstacle with translated preview geometry;
- rectangle or circle creation draws preview geometry over the current scene.

On pointer up, the canvas emits exactly one existing editor command using the final preview geometry. Pointer cancellation discards the preview and emits no command. This keeps autosave and undo history stable while still making movement visually continuous.

## Pointer Lifecycle

Pointer capture begins on pointer down. Movement is processed only for the captured pointer. Pointer up commits the gesture; pointer cancel clears it. All exit paths release or abandon capture and clear transient state so a later gesture cannot inherit stale drag data.

The canvas cursor reflects the active tool and drag state where practical, but cursor styling is secondary to the coordinate and preview corrections.

## Testing

The coordinate and gesture calculations will be extracted into pure helpers where needed and developed test-first. Tests will verify:

- an object grabbed away from its anchor moves by the pointer delta without jumping;
- every obstacle shape translates by the pointer delta;
- Snap quantizes the delta while preserving the original entity offset;
- a circle's center remains the raw pointer-down position with Snap on and off;
- rectangle and circle previews match their final committed geometry;
- pointer cancellation produces no editor command;
- a completed drag produces one command and therefore one undo-history entry.

Existing Create Map coordinate, reducer, renderer, wiring, typecheck, and focused browser checks remain part of verification.

## Acceptance Criteria

- Objects and obstacles visibly follow the pointer throughout a drag.
- Grabbing an entity away from its anchor or center does not make it jump.
- A circle begins where the pointer is pressed and remains aligned with the drawn gesture.
- Snap moves entities in grid-sized deltas without shifting the initial grab point.
- Releasing the pointer creates one undoable change; cancelling creates none.
- Existing Create Map tests and typecheck pass.
