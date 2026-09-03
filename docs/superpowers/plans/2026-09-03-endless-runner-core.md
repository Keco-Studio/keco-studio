# Endless Runner Core Implementation Plan

> **Notation:** The Keco project name appears as `\u9177\u8DD1` so tracked files stay free of Chinese characters, as the CI `only-english-characters` check requires.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first playable 2D side-scrolling endless-runner slice in `/mnt/e/GodotProjects/\u9177\u8DD1`.

**Architecture:** A `Main` Node2D owns the game state, score, obstacle spawning, and world motion. A `Player` CharacterBody2D owns jump physics and emits collision intent; `Obstacle` owns its own movement and cleanup; `HUD` owns presentation and touch input. Visual nodes use procedural drawing behind a replaceable `ArtProvider` boundary.

**Tech Stack:** Godot 4.7, GDScript, Node2D/CharacterBody2D/Area2D, built-in drawing APIs, headless Godot runtime checks.

**Spec:** `docs/superpowers/specs/endless-runner-core-design.md`

## Global Constraints

- Godot project path is `/mnt/e/GodotProjects/\u9177\u8DD1` and is currently empty.
- The target viewport is `960x540`, with horizontal aspect preserved when resized.
- The approved state machine is `READY -> RUNNING -> GAME_OVER`.
- The only gameplay input actions are `jump` (`Space`, `W`, Up Arrow) and `restart` (`R`).
- Only these Godot files may be created or modified: `project.godot`, `scenes/main.tscn`, `scripts/main.gd`, `scripts/player.gd`, `scripts/obstacle.gd`, `scripts/hud.gd`, `scripts/art_provider.gd`.
- Missing optional art must fall back to procedural drawing and never block startup.
- No enemies, combat, power-ups, multiple lanes, persistence, audio, online features, or paid asset generation.

## File Map

- `project.godot`: project identity, display settings, main scene, and input actions.
- `scenes/main.tscn`: scene tree, collision shapes, camera-independent HUD, and script bindings.
- `scripts/main.gd`: state machine, speed ramp, obstacle timer, score, reset, and event wiring.
- `scripts/player.gd`: gravity, jump impulse, floor detection, visual fallback, and collision signal.
- `scripts/obstacle.gd`: leftward movement, visual fallback, and off-screen queue-free.
- `scripts/hud.gd`: score/prompt labels, touch jump/restart buttons, and emitted input intents.
- `scripts/art_provider.gd`: reusable drawing helpers for player, obstacle, ground, and parallax silhouettes.

### Task 1: Create the Godot project contract

**Files:**
- Create: `/mnt/e/GodotProjects/\u9177\u8DD1/project.godot`

**Interfaces:**
- Produces the `jump` and `restart` input actions and sets `run/main_scene` to `res://scenes/main.tscn`.

- [ ] **Step 1: Write the project configuration**

  Set `config/name` to `\u9177\u8DD1`, `run/main_scene` to `res://scenes/main.tscn`, `display/window/size/viewport_width` to `960`, `display/window/size/viewport_height` to `540`, and stretch mode to `canvas_items`.

- [ ] **Step 2: Add input actions**

  Define `jump` with physical Space, W, and Up Arrow events and `restart` with physical R. Keep action names stable because scripts consume them directly.

- [ ] **Step 3: Run the static project check**

  Run: `godot --headless --path /mnt/e/GodotProjects/\u9177\u8DD1 --editor --quit`

  Expected: exit code `0`; no parse error or missing project setting.

- [ ] **Step 4: Record the task checkpoint**

  Record the verified `project.godot` hash and static-check result in the Keco Slice task ledger. The Godot directory is not currently a Git worktree, so do not run a Git commit there.

### Task 2: Add procedural art and reusable gameplay scenes

**Files:**
- Create: `/mnt/e/GodotProjects/\u9177\u8DD1/scripts/art_provider.gd`
- Create: `/mnt/e/GodotProjects/\u9177\u8DD1/scripts/player.gd`
- Create: `/mnt/e/GodotProjects/\u9177\u8DD1/scripts/obstacle.gd`

**Interfaces:**
- `ArtProvider.draw_player(canvas: CanvasItem, rect: Rect2)` and `ArtProvider.draw_obstacle(canvas: CanvasItem, rect: Rect2)` draw fallback visuals.
- `Player` exposes `signal hit_obstacle`, `func begin_jump()`, and `func reset_to(spawn_position: Vector2)`.
- `Obstacle` exports `speed: float`, exposes `func configure(world_speed: float)`, and queues itself when `global_position.x < -120`.

- [ ] **Step 1: Add deterministic visual helpers**

  Implement static drawing helpers with fixed colors and explicit rectangles. Do not load external assets. Keep drawing dimensions independent of viewport scale.

- [ ] **Step 2: Implement player physics**

  Extend `CharacterBody2D`, set gravity to `1500.0`, jump velocity to `-560.0`, process `move_and_slide()`, and emit `hit_obstacle` once when an `Area2D` or body collision is detected. Ignore jump requests while airborne.

- [ ] **Step 3: Implement obstacle motion and cleanup**

  Extend `Area2D`, move left by the configured speed in `_physics_process`, and call `queue_free()` after x is below `-120`.

- [ ] **Step 4: Run static parsing**

  Run: `godot --headless --path /mnt/e/GodotProjects/\u9177\u8DD1 --editor --quit`

  Expected: exit code `0`; all three scripts parse.

- [ ] **Step 5: Record the task checkpoint**

  Record the three script hashes and static-check result in the Keco Slice task ledger. If the user later places this Godot directory under version control, preserve the message `feat: add runner player obstacle and art fallback` for that repository's commit.

### Task 3: Build the main scene and game state loop

**Files:**
- Create: `/mnt/e/GodotProjects/\u9177\u8DD1/scenes/main.tscn`
- Create: `/mnt/e/GodotProjects/\u9177\u8DD1/scripts/main.gd`

**Interfaces:**
- `Main` exposes `enum GameState { READY, RUNNING, GAME_OVER }`, `func start_run()`, `func end_run()`, `func restart_run()`, and `func spawn_obstacle()`.
- `Main` emits `score_changed(value: int)` and `state_changed(state: GameState)`.

- [ ] **Step 1: Assemble the scene tree**

  Create `Main` Node2D with `Background`, `Ground` StaticBody2D, `Player`, `Obstacles` Node2D, `SpawnTimer`, and a `HUD` CanvasLayer placeholder. Add collision shapes so the player stands on the ground and obstacle overlap reaches `Player`.

- [ ] **Step 2: Implement the READY state**

  Start with obstacle spawning disabled and score `0`. A `jump` request from HUD or input calls `start_run()` then `Player.begin_jump()`.

- [ ] **Step 3: Implement RUNNING**

  Tick score from elapsed time, increase world speed gradually from `280.0` to a capped value, start `SpawnTimer`, and instantiate obstacles at the right edge with a bounded random interval.

- [ ] **Step 4: Implement GAME_OVER and reset**

  On `Player.hit_obstacle`, stop the timer, stop player/world updates, emit `GAME_OVER`, and preserve the final score. `restart_run()` removes every child in `Obstacles`, resets player position and speed, and returns to `READY`.

- [ ] **Step 5: Run a headless launch check**

  Run: `timeout 8s godot --headless --path /mnt/e/GodotProjects/\u9177\u8DD1 --quit-after 5`

  Expected: process exits without parser/runtime errors and logs the main scene entering `READY`.

- [ ] **Step 6: Record the task checkpoint**

  Record the scene/script hashes, launch output, and observed initial `READY` state in the Keco Slice task ledger. If the user later places this Godot directory under version control, preserve the message `feat: add endless runner state loop` for that repository's commit.

### Task 4: Add HUD and touch controls

**Files:**
- Create: `/mnt/e/GodotProjects/\u9177\u8DD1/scripts/hud.gd`
- Modify: `/mnt/e/GodotProjects/\u9177\u8DD1/scenes/main.tscn`

**Interfaces:**
- `HUD` emits `jump_requested` and `restart_requested`.
- `HUD` consumes `Main.score_changed` and `Main.state_changed`.

- [ ] **Step 1: Add labels and buttons to the scene**

  Add score label at the top-left, a centered start/game-over prompt, a bottom-right jump button, and a game-over restart button. Anchor controls so they remain inside the viewport when resized.

- [ ] **Step 2: Implement HUD state rendering**

  Render `READY` prompt and touch jump button, hide the prompt while running, and show final score plus restart button in `GAME_OVER`. Keep text within fixed controls at the `960x540` baseline.

- [ ] **Step 3: Wire keyboard and touch paths**

  Convert both button presses and `_unhandled_input` actions into the same emitted signals; `R` should restart immediately during game-over.

- [ ] **Step 4: Run manual runtime checks**

  Run: `godot --path /mnt/e/GodotProjects/\u9177\u8DD1`

  Verify: the first Space/W/Up press starts and jumps, the touch jump button behaves identically, collision freezes the scene, and both R and the restart button reset score and obstacles.

- [ ] **Step 5: Record the task checkpoint**

  Record the HUD script/scene hashes and manual input results in the Keco Slice task ledger. If the user later places this Godot directory under version control, preserve the message `feat: add runner HUD and touch controls` for that repository's commit.

### Task 5: Verify acceptance and stability

**Files:**
- Modify only the approved files if a verification defect is found.

**Interfaces:**
- Runtime observations must report the loaded Keco source aggregate hash and state/score transitions using `KECO_OBSERVATION` records.

- [ ] **Step 1: Run static validation**

  Run: `godot --headless --path /mnt/e/GodotProjects/\u9177\u8DD1 --editor --quit`

  Expected: exit code `0` with no script, scene, or input-action errors.

- [ ] **Step 2: Run fresh runtime verification**

  Launch with `godot --path /mnt/e/GodotProjects/\u9177\u8DD1`, exercise start, jump, clear, collision, score, keyboard restart, and touch restart, then capture `KECO_OBSERVATION` output.

- [ ] **Step 3: Run the stability pass**

  Run for at least 60 seconds, inspect the remote scene tree or debug counter, and confirm off-screen obstacles are freed and the score increases continuously.

- [ ] **Step 4: Run repository-level contract checks**

  Run the applicable Keco validators from `plugins/keco-claude/scripts/` against the Slice plan, runtime observations, and delivery policy. Record failures without claiming acceptance until repaired.

- [ ] **Step 5: Record verification completion**

  Record final file hashes, validator outputs, runtime observations, and acceptance status in the Keco Slice task ledger. Do not create a Git commit in the non-versioned Godot directory.
