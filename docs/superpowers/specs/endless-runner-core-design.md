# Endless Runner Core Slice

## Goal

Deliver the first playable 2D side-scrolling endless-runner slice for the Keco project `酷跑`.

## Source

- Source profile: `user_idea`
- Keco project: `酷跑`
- Keco project ID: `4f3d0616-05f4-42f5-91e4-46300ab29b30`
- Godot project path: `/mnt/e/GodotProjects/酷跑`
- Source excerpt: automatic running, jumping, obstacles, score, collision game-over, restart
- No authoritative GDD or feedback document exists in the selected Keco project.

## Scope

The slice includes automatic forward motion, one ground obstacle type, jump input, collision game-over, score feedback, restart, and a touch-friendly jump/restart UI. The first version uses programmatic 2D drawing and keeps an art-provider boundary so later Keco/PixelLab assets can replace the placeholders.

Out of scope: enemies, combat, power-ups, multiple lanes, procedural level streaming beyond the obstacle generator, persistence, audio, online features, and paid asset generation.

## Architecture

- `Main` owns the `READY -> RUNNING -> GAME_OVER` state machine, world speed, obstacle spawning, score, and restart.
- `Player` is a `CharacterBody2D` that owns gravity, jump impulse, floor checks, and collision reporting.
- `Obstacle` is an independently spawned scene that moves left and frees itself after leaving the viewport.
- `Ground` is a static collision body with a visible programmatic floor.
- `HUD` renders score, start/game-over prompts, and touch controls; it emits jump and restart requests.
- `ArtProvider` exposes programmatic fallback drawing behind replaceable visual nodes.

The player stays near 25% of the viewport while obstacles and parallax layers move left. `Main` sends state and score updates to `HUD`; `Player` emits collision/game-over events; `HUD` emits input intent. Missing optional art must fall back to procedural drawing and never prevent startup.

## Controls

- `jump`: `Space`, `W`, and Up Arrow; also a bottom-right touch button.
- `restart`: `R`; also the HUD restart button after game-over.

The first jump transitions the game from `READY` to `RUNNING`. A collision freezes gameplay, preserves the final score, and transitions to `GAME_OVER`.

## Visual Direction

Use a bright arcade presentation with a dark sky, warm floor, high-contrast player/obstacle silhouettes, and two slow parallax geometric background layers. The target viewport is `960x540` with responsive scaling while preserving the horizontal aspect.

## Planned Files

Only the following Godot project files are in scope for implementation:

- `project.godot`
- `scenes/main.tscn`
- `scripts/main.gd`
- `scripts/player.gd`
- `scripts/obstacle.gd`
- `scripts/hud.gd`
- `scripts/art_provider.gd`

## Acceptance

1. The project launches into the main scene without parse or missing-input errors.
2. The first jump starts the run and the player can clear the ground obstacle.
3. Contact with an obstacle always enters `GAME_OVER`; player and obstacles stop moving.
4. The score increases during a run and remains visible on game-over.
5. `R` and the HUD restart button reset player position, obstacles, state, and score.
6. Keyboard and touch jump paths produce the same jump behavior.
7. A 60-second run does not accumulate off-screen obstacle nodes or show obvious stutter.

## Verification

- Static: Godot parses `project.godot`, the main scene, scripts, and input actions.
- Runtime: fresh launch, jump, obstacle clear, collision, score, keyboard restart, touch restart.
- Stability: run for 60 seconds and inspect obstacle count and score progression.

## Risks and Decisions

- A fully art-driven slice would add generation and asset-versioning cost, so procedural visuals are the approved first version.
- The empty Godot directory means no existing scene or input contract needs migration.
- No Keco source document is available; future GDD or feedback must supersede this `user_idea` source through a successor run.
