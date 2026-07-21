import type { BattleUnit } from '@keco/battle-engine';
import type { BattleEntity } from '../battle-core/domain/entities/battle-entity';
import type { BattleSession } from '../battle-core/domain/entities/battle-session';

export function entityToKecoUnit(entity: BattleEntity): BattleUnit {
  return {
    id: entity.id,
    name: entity.name,
    hp: entity.resources.hp,
    maxHp: entity.resources.maxHp,
    atk: entity.atk,
    def: entity.def,
    spd: entity.spd,
    mp: entity.resources.mp,
    maxMp: entity.resources.maxMp,
    type: entity.team === 'left' ? 'player' : 'monster',
    element: null,
    dot: null,
    buffs: [],
    control: null,
  };
}

/**
 * Merge live entity vitals with keco-only combat state (element, buffs, etc.).
 * Entity HP/MP are authoritative — keco.units can lag behind tick regen.
 */
export function mergeEntityIntoKecoUnit(
  entity: BattleEntity,
  kecoUnit: BattleUnit | undefined,
): BattleUnit {
  const fromEntity = entityToKecoUnit(entity);
  if (!kecoUnit) return fromEntity;
  return {
    ...fromEntity,
    element: kecoUnit.element,
    dot: kecoUnit.dot,
    buffs: kecoUnit.buffs,
    control: kecoUnit.control,
  };
}

export type ApplyKecoUnitOptions = {
  /** When false, HP syncs but MP stays on the entity (target of someone else's skill). */
  syncMp?: boolean;
};

export function applyKecoUnitToEntity(
  entity: BattleEntity,
  unit: BattleUnit,
  options?: ApplyKecoUnitOptions,
): BattleEntity {
  const syncMp = options?.syncMp !== false;
  return {
    ...entity,
    atk: unit.atk,
    def: unit.def,
    spd: unit.spd,
    alive: unit.hp > 0,
    resources: {
      ...entity.resources,
      hp: unit.hp,
      maxHp: unit.maxHp,
      ...(syncMp ? { mp: unit.mp, maxMp: unit.maxMp } : {}),
    },
  };
}

/** Keep keco.units vitals aligned with session entities after passive regen etc. */
export function syncKecoUnitsFromEntities(session: BattleSession): BattleSession {
  if (!session.keco) return session;
  const { left, right, keco } = session;
  return {
    ...session,
    keco: {
      ...keco,
      units: {
        ...keco.units,
        [left.id]: mergeEntityIntoKecoUnit(left, keco.units[left.id]),
        [right.id]: mergeEntityIntoKecoUnit(right, keco.units[right.id]),
      },
    },
  };
}
