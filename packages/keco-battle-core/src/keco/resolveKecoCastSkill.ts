import type { Skill, BattleState, BattleLogEntry } from '@keco/battle-engine';
import { executeSkill, checkBattleResult } from '@keco/battle-engine';
import type { BattleSession } from '../battle-core/domain/entities/battle-session';
import type { BattleEntity } from '../battle-core/domain/entities/battle-entity';
import { getBattleSkillDefinition } from '../battle-core/content/skills/basic-skill-catalog';
import { KECO_SKILL_COOLDOWN_TICK_MULTIPLIER } from './kecoSkillBridge';
import { appendEvent, updateEntity } from '../battle-core/engine/session-helpers';
import type { KecoCombatExtension } from './types';
import { applyKecoUnitToEntity, mergeEntityIntoKecoUnit } from './entitySync';

function pseudoBattleState(keco: KecoCombatExtension, turn: number): BattleState {
  const units = Object.values(keco.units);
  const player = keco.units['poc-player'] ?? units.find((u) => u.type === 'player') ?? units[0];
  const monster = keco.units['poc-enemy'] ?? units.find((u) => u.type === 'monster') ?? units[1];
  return {
    phase: 'player_turn',
    currentTurn: turn,
    player,
    monster,
    selectedSkill: null,
    skillCooldowns: {},
    battleLogs: keco.logs,
    result: null,
  };
}

export type KecoCastResult = {
  session: BattleSession;
  damage: number;
  applied: boolean;
  keco: KecoCombatExtension;
};

/**
 * Resolve cast_skill (or basic_attack fallback) using keco elemental executeSkill.
 */
export function resolveKecoCastSkill(input: {
  session: BattleSession;
  keco: KecoCombatExtension;
  actor: BattleEntity;
  target: BattleEntity;
  skillId: string;
  commandId: string;
  tick: number;
}): KecoCastResult {
  const { session, actor, target, commandId, tick } = input;
  let keco = input.keco;

  const pocDef = getBattleSkillDefinition(input.skillId);
  const kecoSkill =
    keco.skillById[input.skillId] ??
    (pocDef ? keco.skillById[Object.keys(keco.skillById)[0]] : undefined);

  if (!kecoSkill) {
    return { session, damage: 0, applied: false, keco };
  }

  if (actor.resources.mp < kecoSkill.mpCost) {
    return { session, damage: 0, applied: false, keco };
  }

  let attacker = mergeEntityIntoKecoUnit(actor, keco.units[actor.id]);
  let defender = mergeEntityIntoKecoUnit(target, keco.units[target.id]);

  const pseudo = pseudoBattleState(keco, keco.turn);
  const result = executeSkill(pseudo, attacker, defender, kecoSkill, [...keco.logs]);

  attacker = result.newAttacker;
  defender = result.newDefender;
  keco = {
    ...keco,
    logs: result.newLogs,
    units: {
      ...keco.units,
      [actor.id]: attacker,
      [target.id]: defender,
    },
  };

  const damage = result.totalDamage;

  const updatedSlots = actor.skillSlots.map((slot) =>
    slot.skillId === input.skillId
      ? {
          ...slot,
          cooldownTick:
            session.tick
            + (pocDef?.cooldownTicks ?? kecoSkill.maxCooldown * KECO_SKILL_COOLDOWN_TICK_MULTIPLIER),
        }
      : slot,
  );

  let nextActor: BattleEntity = {
    ...applyKecoUnitToEntity(actor, attacker),
    skillSlots: updatedSlots,
  };

  const nextTarget = applyKecoUnitToEntity(target, defender, { syncMp: false });

  let nextSession = updateEntity(session, nextActor);
  nextSession = updateEntity(nextSession, nextTarget);

  const leftUnit = keco.units[nextSession.left.id] ?? attacker;
  const rightUnit = keco.units[nextSession.right.id] ?? defender;
  const battleResult = checkBattleResult(leftUnit, rightUnit);
  if (battleResult) {
    nextSession = {
      ...nextSession,
      result:
        battleResult === 'player_win'
          ? 'left_win'
          : battleResult === 'monster_win'
            ? 'right_win'
            : 'draw',
    };
  }

  nextSession = appendEvent(nextSession, 'damage_applied', {
    commandId,
    actorId: actor.id,
    targetId: target.id,
    damage,
    rawDamage: damage,
    shieldAbsorbed: 0,
    skillId: kecoSkill.id,
    resolver: 'keco_element',
  });

  nextSession = appendEvent(nextSession, 'action_executed', {
    commandId,
    actorId: actor.id,
    targetId: target.id,
    action: 'cast_skill',
    skillId: kecoSkill.id,
    skillName: kecoSkill.name,
  });

  return { session: nextSession, damage, applied: true, keco };
}
