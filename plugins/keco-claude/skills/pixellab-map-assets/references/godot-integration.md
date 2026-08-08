# Godot Integration Reference

## TileSet and TileMap

Use the Godot version and node type already present in the project. In Godot 4 projects, prefer the existing `TileMapLayer` pattern when the scene already uses layers; otherwise extend the existing `TileMap` without introducing a second map abstraction.

1. Set texture filtering to nearest for pixel art.
2. Create an atlas source with the exact generated tile size.
3. Add a physics layer for solid terrain and author collision polygons per tile.
4. Add terrain sets/peering rules from the generated Wang or corner metadata.
5. Paint a small test patch covering straight, corner, transition, and border cases before filling the whole map.

## Objects and Building Parts

Import transparent objects as `Sprite2D` textures or reusable scenes. Keep the sprite origin at the project's established ground contact point. Add a `StaticBody2D` with a rectangle or circle, or a `NavigationObstacle2D`, only when the gameplay design requires it. The PNG alpha bounds are not collision geometry.

## Existing Full-Image Maps

When a scene displays a single background image, a generated tileset does not supply a layout automatically. Keep the image as a background while testing generated props, or migrate deliberately by recreating the layout in a TileMap. Keep hand-authored geometry such as `RECT_OBSTACLES` and `CIRCLE_OBSTACLES` until equivalent TileSet physics or scene collisions have been verified.

## Verification

Run the project and check:

- the atlas renders at the intended scale with no filtering blur;
- terrain transitions select the expected neighboring tiles;
- objects sit on the intended ground contact point;
- the player cannot pass through walls, rocks, or building columns;
- walkable gaps remain traversable and no invisible transparent bounds block movement.
