import { useCallback, useState } from 'react';

export type CombatAnim = 'idle' | 'attack' | 'cast' | 'hit';

export type CombatFxState = {
  anim: CombatAnim;
  untilMs: number;
  offsetX: number;
  offsetY: number;
};

const DEFAULT_COMBAT_FX: CombatFxState = {
  anim: 'idle',
  untilMs: 0,
  offsetX: 0,
  offsetY: 0,
};

function buildCombatFxState(
  nowMs: number,
  anim: CombatAnim,
  opts?: { toward?: { x: number; y: number }; from?: { x: number; y: number }; durationMs?: number },
): CombatFxState {
  const durationMs =
    opts?.durationMs ?? (anim === 'hit' ? 140 : anim === 'cast' ? 210 : anim === 'attack' ? 160 : 0);
  let offsetX = 0;
  let offsetY = 0;
  if (anim === 'attack' || anim === 'cast') {
    const tx = opts?.toward?.x ?? 0;
    const ty = opts?.toward?.y ?? 0;
    const len = Math.hypot(tx, ty) || 1;
    const mag = anim === 'attack' ? 0.14 : 0.08;
    offsetX = (tx / len) * mag;
    offsetY = (ty / len) * mag;
  } else if (anim === 'hit') {
    const fx = opts?.from?.x ?? 0;
    const fy = opts?.from?.y ?? 0;
    const len = Math.hypot(fx, fy) || 1;
    const mag = 0.1;
    offsetX = (fx / len) * mag;
    offsetY = (fy / len) * mag;
  }
  return { anim, untilMs: nowMs + durationMs, offsetX, offsetY };
}

export function useArenaCombatFx() {
  const [playerCombatFx, setPlayerCombatFx] = useState<CombatFxState>(DEFAULT_COMBAT_FX);
  const [enemyCombatFx, setEnemyCombatFx] = useState<CombatFxState>(DEFAULT_COMBAT_FX);

  const resetCombatFx = useCallback(() => {
    setPlayerCombatFx(DEFAULT_COMBAT_FX);
    setEnemyCombatFx(DEFAULT_COMBAT_FX);
  }, []);

  const triggerCombatFx = useCallback(
    (
      role: 'player' | 'enemy',
      anim: CombatAnim,
      opts?: { toward?: { x: number; y: number }; from?: { x: number; y: number }; durationMs?: number },
    ) => {
      const nextFx = buildCombatFxState(Date.now(), anim, opts);
      if (role === 'player') setPlayerCombatFx(nextFx);
      else setEnemyCombatFx(nextFx);
    },
    [],
  );

  return { playerCombatFx, enemyCombatFx, resetCombatFx, triggerCombatFx };
}

export function spriteMotionStyle(
  fx: CombatFxState,
  actorPx: number,
): { transform: string; filter?: string; transition: string } {
  const active = fx.untilMs > Date.now();
  const ox = active ? fx.offsetX * actorPx : 0;
  const oy = active ? fx.offsetY * actorPx : 0;
  const filter =
    active && fx.anim === 'hit'
      ? 'brightness(1.28) saturate(1.2)'
      : active && (fx.anim === 'attack' || fx.anim === 'cast')
        ? 'brightness(1.12)'
        : undefined;
  return {
    transform: ox || oy ? `translate(${ox}px, ${oy}px)` : 'none',
    filter,
    transition: 'transform 110ms ease-out, filter 90ms ease-out',
  };
}
