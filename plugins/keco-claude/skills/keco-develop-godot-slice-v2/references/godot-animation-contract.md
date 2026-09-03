# Godot Animation Contract

Use this contract when a slice contains a character, animation, spritesheet, or an animation preview. The import boundary produces Godot resources only; gameplay controllers and demo scenes remain out of scope unless the selected slice explicitly includes them.

## Input metadata

Each animation file must declare `name`, `sheetPath`, `frameWidth`, `frameHeight`, `frameCount`, `fps`, and `loop`. Validate the actual PNG dimensions before building resources. For a horizontal sheet, `sheetWidth == frameWidth * frameCount` and `sheetHeight == frameHeight`; use the output frame size, not the source image size.

Use one canonical character asset for all motions. Record perspective (`platformer`, `topdown`, or `isometric`), source view, state name, and any generated preparation dependency. Common states are `idle`, `walk`, `run`, `jump`, `attack`, `hurt`, and `death`; loop only locomotion/idle states unless the design says otherwise.

## Deterministic resource path

The preferred path is the bundled resource builder, not hand-written resource text:

1. Validate each authoritative Keco file and its SHA-256, then validate the whole package with the bundled `validate_generated_asset_package.py`.
2. Write an animation manifest with `version: 1`, `resourcePath`, and one entry per animation carrying `name`, `sheetPath`, `sheetFile`, `frameWidth`, `frameHeight`, `frameCount`, `fps`, and `loop`.
3. Run the bundled `build_spriteframes_resource.py`. It emits one `Texture2D` ext_resource per distinct spritesheet, one `AtlasTexture` per frame using `Rect2(frameIndex * frameWidth, 0, frameWidth, frameHeight)`, and preserves `fps`, `loop`, and stable animation names.
4. Treat a frame-geometry mismatch, conflicting sheet declaration, or output/resource-path mismatch as a blocker. Do not edit around the rejection by hand.
5. Add or update only the target `AnimatedSprite2D` node and its `sprite_frames` reference.

The resource must be self-contained under a planned `res://` folder, and every ext_resource path must exist before runtime evaluation.

## Packaged export path

If a provider exposes a typed Godot package operation, preflight its live schema, materialize every returned text file and signed asset download locally, then run the same path, frame, dimension, and import checks. Do not assume the provider wrote files into the project. If the operation is unavailable, use the manual path; do not call an invented endpoint.

## Static and runtime evidence

Static checks must prove all sheet paths exist, frame geometry matches, the `.tres` contains every frame, and the target scene references `AnimatedSprite2D`. Runtime checks must emit a `KECO_OBSERVATION` record with the current snapshot hash and the selected animation state/frame. Visual alignment and perceived motion remain `manual_required` when the configured Godot MCP cannot capture them.
