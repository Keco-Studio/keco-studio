import type { BattleSession } from '@keco/battle-core';
import type { MutableRefObject } from 'react';
import { resolveSkillFxProfile } from './skillFxProfile';
import { buildProjectileFxInput } from './projectileFxUtils';
import type { MapFloatText, MapImpactFx, MapProjectileFx } from './useMapTransientFx';
import type { CombatAnim } from './useArenaCombatFx';

type GridPos = { x: number; y: number };

type CommandMeta = {
  actorId: string;
  targetId: string;
  action: string;
  skillId: string;
};

export type ArenaFxCallbacks = {
  triggerCombatFx: (
    role: 'player' | 'enemy',
    anim: CombatAnim,
    opts?: { toward?: GridPos; from?: GridPos },
  ) => void;
  pushProjectileFx: (item: Omit<MapProjectileFx, 'id'>) => void;
  pushFloatText: (item: Omit<MapFloatText, 'id'>) => void;
  pushImpactFx: (item: Omit<MapImpactFx, 'id'>) => void;
};

function roleByEntityId(session: BattleSession, entityId: string): 'player' | 'enemy' | null {
  if (entityId === session.left.id) return 'player';
  if (entityId === session.right.id) return 'enemy';
  return null;
}

function posByEntityId(session: BattleSession, entityId: string): GridPos | null {
  if (entityId === session.left.id) return session.left.position;
  if (entityId === session.right.id) return session.right.position;
  return null;
}

function damageSide(session: BattleSession, targetId: string): 'player' | 'enemy' | null {
  if (targetId === session.left.id) return 'player';
  if (targetId === session.right.id) return 'enemy';
  return null;
}

function towardVector(actorPos: GridPos, targetPos: GridPos): GridPos {
  return { x: targetPos.x - actorPos.x, y: targetPos.y - actorPos.y };
}

export function processArenaBattleEvents(
  session: BattleSession,
  evStart: number,
  commandMetaStore: MutableRefObject<Record<string, CommandMeta>>,
  projectileTargetStore: MutableRefObject<Record<string, { target: 'player' | 'enemy' }>>,
  fx: ArenaFxCallbacks,
): void {
  for (let i = evStart; i < session.events.length; i++) {
    const ev = session.events[i];
    if (session.phase === 'preparation') continue;

    if (ev.type === 'command_received') {
      const commandId = String(ev.payload.commandId ?? '');
      if (!commandId) continue;
      commandMetaStore.current[commandId] = {
        actorId: String(ev.payload.actorId ?? ''),
        targetId: String(ev.payload.targetId ?? ''),
        action: String(ev.payload.action ?? ''),
        skillId: String(ev.payload.skillId ?? ''),
      };
    }

    if (ev.type === 'action_executed') {
      const commandId = String(ev.payload.commandId ?? '');
      const meta = commandMetaStore.current[commandId];
      const actorId = meta?.actorId ?? String(ev.payload.actorId ?? '');
      const targetId = meta?.targetId ?? String(ev.payload.targetId ?? '');
      const action = meta?.action ?? String(ev.payload.action ?? '');
      const skillId = meta?.skillId ?? String(ev.payload.skillId ?? '');
      const actorRole = roleByEntityId(session, actorId);
      const targetRole = roleByEntityId(session, targetId);
      const actorPos = posByEntityId(session, actorId);
      const targetPos = posByEntityId(session, targetId);

      if (actorRole && targetRole && actorPos && targetPos) {
        if (action === 'basic_attack') {
          fx.triggerCombatFx(actorRole, 'attack', { toward: towardVector(actorPos, targetPos) });
        } else if (action === 'cast_skill') {
          fx.triggerCombatFx(actorRole, 'cast', { toward: towardVector(actorPos, targetPos) });
        }

        const fxProfile = resolveSkillFxProfile({ action, skillId, actorRole });
        if (fxProfile.projectileKind) {
          fx.pushProjectileFx(
            buildProjectileFxInput({
              kind: fxProfile.projectileKind,
              from: actorRole,
              actorPos,
              targetPos,
              durationMs: fxProfile.durationMs,
            }),
          );
          if (commandId) projectileTargetStore.current[commandId] = { target: targetRole };
        }
      }

      if (commandId) delete commandMetaStore.current[commandId];
    }

    if (ev.type === 'damage_applied') {
      const dmg = Math.max(0, Number(ev.payload.damage ?? 0));
      const commandId = String(ev.payload.commandId ?? '');
      const tid = String(ev.payload.targetId ?? '');
      const actorId = String(ev.payload.actorId ?? '');
      const actorPos = posByEntityId(session, actorId);
      const targetPos = posByEntityId(session, tid);
      const targetRole = roleByEntityId(session, tid);

      if (targetRole && actorPos && targetPos && dmg > 0) {
        fx.triggerCombatFx(targetRole, 'hit', { from: towardVector(actorPos, targetPos) });
      }

      const side = damageSide(session, tid);
      if (side && dmg > 0) {
        fx.pushFloatText({
          target: side,
          text: `-${dmg}`,
          variant: 'damage',
          offsetX: (Math.random() - 0.5) * 28,
        });
      }

      const impactedRole = commandId ? projectileTargetStore.current[commandId]?.target : undefined;
      if (impactedRole) {
        const impactedPos = impactedRole === 'player' ? session.left.position : session.right.position;
        fx.pushImpactFx({ kind: 'hit', target: impactedRole, x: impactedPos.x, y: impactedPos.y });
        delete projectileTargetStore.current[commandId];
      }
    }

    if (ev.type === 'command_rejected') {
      const reason = String(ev.payload.reason ?? '');
      const commandId = String(ev.payload.commandId ?? '');
      if (reason === 'target_dodged') {
        const dodgedRole = commandId ? projectileTargetStore.current[commandId]?.target : undefined;
        if (dodgedRole) {
          const dodgePos = dodgedRole === 'player' ? session.left.position : session.right.position;
          fx.pushImpactFx({ kind: 'dodge', target: dodgedRole, x: dodgePos.x, y: dodgePos.y });
          delete projectileTargetStore.current[commandId];
        }
      }
      if (commandId) delete commandMetaStore.current[commandId];
    }

    if (ev.type === 'effect_applied') {
      const effectType = String(ev.payload.effectType ?? '');
      const targetId = String(ev.payload.targetId ?? ev.targetId ?? '');
      const role = roleByEntityId(session, targetId);
      const pos = posByEntityId(session, targetId);
      if (role && pos && (effectType === 'freeze' || effectType === 'stun')) {
        fx.pushImpactFx({ kind: 'hit', target: role, x: pos.x, y: pos.y });
      }
    }
  }
}
