/** Sprite path helpers — ported from battle-poc `gameMapUtils.ts`. */

export const ROTATION_KEYS = [
  'north',
  'south',
  'east',
  'west',
  'north-east',
  'north-west',
  'south-east',
  'south-west',
] as const;

export type RotationKey = (typeof ROTATION_KEYS)[number];

export const DEFAULT_DIRECTION: RotationKey = 'south';

/** battle-poc default arena background (16×16). */
export const POC_ARENA_MAP_BG =
  '/assets/maps/top-down-pixel-art-rpg-battle-arena-map-wide-ope-1777006352683.png';

export const POC_ARENA_MAP_WIDTH = 16;
export const POC_ARENA_MAP_HEIGHT = 16;

const ENEMY_WALK_FRAMES_BY_FACING: Record<RotationKey, number> = {
  north: 8,
  south: 8,
  east: 8,
  west: 8,
  'north-east': 8,
  'north-west': 8,
  'south-east': 8,
  'south-west': 8,
};

const PLAYER_WALK_DIR_BY_FACING: Record<RotationKey, string> = {
  north: 'north',
  south: 'south',
  east: 'east-9b803dd5',
  west: 'west-44afc449',
  'north-east': 'north-east-76d09498',
  'north-west': 'north-west-6213b10b',
  'south-east': 'south-east-b3963b75',
  'south-west': 'south-west-326192d3',
};

function framePath(baseDir: string, frames: number, tick: number): string {
  const safeFrames = Math.max(1, Math.floor(frames));
  const frame = ((tick % safeFrames) + safeFrames) % safeFrames;
  return `${baseDir}/frame_${String(frame).padStart(3, '0')}.png`;
}

export function toEnemyIdlePngPath(direction: RotationKey): string {
  return `/enemy/idle/${direction}.png`;
}

export function toPlayerIdlePngPath(direction: RotationKey): string {
  return `/player/idle/${direction}.png`;
}

export function toEnemyWalkFramePath(direction: RotationKey, tick: number): string {
  return framePath(`/enemy/walk/${direction}`, ENEMY_WALK_FRAMES_BY_FACING[direction] ?? 8, tick);
}

export function toPlayerWalkFramePath(direction: RotationKey, tick: number): string {
  const dir = PLAYER_WALK_DIR_BY_FACING[direction] ?? direction;
  return framePath(`/player/walk/${dir}`, 8, tick);
}

export function resolveDirectionByDelta(dx: number, dy: number): RotationKey {
  if (dx === 0 && dy === 0) return DEFAULT_DIRECTION;
  if (dx > 0 && dy < 0) return 'north-east';
  if (dx < 0 && dy < 0) return 'north-west';
  if (dx > 0 && dy > 0) return 'south-east';
  if (dx < 0 && dy > 0) return 'south-west';
  if (dx > 0) return 'east';
  if (dx < 0) return 'west';
  if (dy < 0) return 'north';
  return 'south';
}
