'use client';

import type { ProjectileKind } from './skillFxProfile';
import type { MapFloatText, MapImpactFx, MapMoveFx, MapProjectileFx } from './useMapTransientFx';
import fxStyles from './battleFx.module.css';

type GridToScreen = (x: number, y: number) => { x: number; y: number };

const PROJECTILE_CLASS: Record<ProjectileKind, string> = {
  arrow: fxStyles.projectileArrow,
  fireball: fxStyles.projectileFireball,
  arcane_bolt: fxStyles.projectileArcane,
  frost: fxStyles.projectileFrost,
  slash: fxStyles.projectileSlash,
  support: fxStyles.projectileSupport,
  generic: fxStyles.projectileGeneric,
};

type Props = {
  gridToScreen: GridToScreen;
  playerGrid: { x: number; y: number };
  enemyGrid: { x: number; y: number };
  projectileFx: MapProjectileFx[];
  impactFx: MapImpactFx[];
  moveFx: MapMoveFx[];
  floatTexts: MapFloatText[];
};

export function MapFxOverlay({
  gridToScreen,
  playerGrid,
  enemyGrid,
  projectileFx,
  impactFx,
  moveFx,
  floatTexts,
}: Props) {
  return (
    <div className={fxStyles.fxLayer}>
      {projectileFx.map((fx) => {
        const start = gridToScreen(fx.startX, fx.startY);
        const end = gridToScreen(fx.startX + fx.deltaX, fx.startY + fx.deltaY);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const angle = Math.atan2(dy, dx);
        return (
          <span
            key={fx.id}
            className={`${fxStyles.projectile} ${PROJECTILE_CLASS[fx.kind]}`}
            style={{
              left: start.x,
              top: start.y,
              ['--proj-dx' as string]: `${dx}px`,
              ['--proj-dy' as string]: `${dy}px`,
              ['--proj-rot' as string]: `${angle}rad`,
              animationDuration: `${fx.durationMs}ms`,
            }}
          />
        );
      })}
      {impactFx.map((fx) => {
        const p = gridToScreen(fx.x, fx.y);
        const impactClass =
          fx.kind === 'hit'
            ? fx.target === 'player'
              ? fxStyles.impactHitPlayer
              : fxStyles.impactHitEnemy
            : fx.target === 'player'
              ? fxStyles.impactDodgePlayer
              : fxStyles.impactDodgeEnemy;
        return (
          <span
            key={fx.id}
            className={`${fxStyles.impact} ${impactClass}`}
            style={{ left: p.x, top: p.y }}
          />
        );
      })}
      {moveFx.map((fx) => {
        const screen = gridToScreen(fx.x, fx.y);
        const tintClass = fx.target === 'player' ? fxStyles.stepFxPlayer : fxStyles.stepFxEnemy;
        return (
          <span
            key={fx.id}
            className={`${fxStyles.stepFx} ${tintClass}`}
            style={{ left: screen.x, top: screen.y }}
          />
        );
      })}
      {floatTexts.map((h) => {
        const grid = h.target === 'player' ? playerGrid : enemyGrid;
        const screen = gridToScreen(grid.x, grid.y);
        const colorClass =
          h.variant === 'heal'
            ? fxStyles.floatHeal
            : h.variant === 'exp'
              ? fxStyles.floatExp
              : h.variant === 'proficiency'
                ? fxStyles.floatProficiency
                : h.target === 'player'
                  ? fxStyles.floatDamagePlayer
                  : fxStyles.floatDamageEnemy;
        const floatYOffset = h.variant === 'exp' || h.variant === 'proficiency' ? -56 : -40;
        return (
          <div
            key={h.id}
            className={`${fxStyles.floatText} ${colorClass}`}
            style={{ left: screen.x + h.offsetX, top: screen.y + floatYOffset }}
          >
            {h.text}
          </div>
        );
      })}
    </div>
  );
}
