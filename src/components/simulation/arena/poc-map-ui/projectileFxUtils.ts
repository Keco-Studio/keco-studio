import type { ProjectileKind } from './skillFxProfile';

type GridPos = { x: number; y: number };

export function buildProjectileFxInput(input: {
  kind: ProjectileKind;
  from: 'player' | 'enemy';
  actorPos: GridPos;
  targetPos: GridPos;
  durationMs: number;
}): Omit<import('./useMapTransientFx').MapProjectileFx, 'id'> {
  const { kind, from, actorPos, targetPos, durationMs } = input;
  return {
    kind,
    from,
    startX: actorPos.x,
    startY: actorPos.y,
    deltaX: targetPos.x - actorPos.x,
    deltaY: targetPos.y - actorPos.y,
    durationMs,
  };
}
