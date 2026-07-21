import type { Skill } from '@keco/battle-engine';
import type { Element } from '@keco/battle-engine';
import { createMapBattleSession, type MapBattleStartConfig } from '../map-battle/createMapBattleSession';
import type { BattleSession } from '../battle-core/domain/entities/battle-session';
import { registerKecoSkills, defaultBasicKecoSkill } from './kecoSkillBridge';
import { entityToKecoUnit } from './entitySync';
import type { KecoCombatExtension } from './types';
import type { TotalStats } from '../compat/combatStats';

export type KecoArenaConfig = {
  mapWidth?: number;
  mapHeight?: number;
  playerName: string;
  playerGrid?: { x: number; y: number };
  playerStats: TotalStats;
  playerHp: number;
  playerMp: number;
  playerMaxMp: number;
  playerSkillIds: string[];
  enemyName: string;
  enemyGrid?: { x: number; y: number };
  enemyStats: TotalStats;
  enemyHp: number;
  enemyMp: number;
  enemyMaxMp: number;
  enemySkillIds: string[];
  skills: Skill[];
  monsterInitialElement?: Element;
  preparationTicks?: number;
};

export function createKecoArenaSession(cfg: KecoArenaConfig): BattleSession {
  const skillById = registerKecoSkills(cfg.skills);
  if (!skillById[defaultBasicKecoSkill().id]) {
    registerKecoSkills([defaultBasicKecoSkill()]);
    skillById[defaultBasicKecoSkill().id] = defaultBasicKecoSkill();
  }

  const mapCfg: MapBattleStartConfig = {
    mapWidth: cfg.mapWidth ?? 12,
    mapHeight: cfg.mapHeight ?? 8,
    playerName: cfg.playerName,
    playerGrid: cfg.playerGrid ?? { x: 3, y: Math.floor((cfg.mapHeight ?? 8) / 2) },
    playerStats: cfg.playerStats,
    playerHp: cfg.playerHp,
    playerMp: cfg.playerMp,
    playerMaxMp: cfg.playerMaxMp,
    playerSkillIds: cfg.playerSkillIds,
    enemyName: cfg.enemyName,
    enemyId: 'poc-enemy',
    enemyGrid: cfg.enemyGrid ?? { x: (cfg.mapWidth ?? 12) - 4, y: Math.floor((cfg.mapHeight ?? 8) / 2) },
    enemyStats: cfg.enemyStats,
    enemySkillIds: cfg.enemySkillIds,
    battleDecisionMode: 'manual',
  };

  let session = createMapBattleSession(mapCfg);

  session = {
    ...session,
    left: {
      ...session.left,
      resources: {
        ...session.left.resources,
        hp: Math.min(session.left.resources.maxHp, Math.max(0, cfg.playerHp)),
        mp: Math.min(cfg.playerMaxMp, Math.max(0, cfg.playerMp)),
        maxMp: cfg.playerMaxMp,
      },
    },
    right: {
      ...session.right,
      resources: {
        ...session.right.resources,
        hp: Math.min(session.right.resources.maxHp, Math.max(0, cfg.enemyHp)),
        mp: Math.min(cfg.enemyMaxMp, Math.max(0, cfg.enemyMp)),
        maxMp: cfg.enemyMaxMp,
      },
    },
  };

  if (cfg.preparationTicks != null) {
    session = {
      ...session,
      preparationEndTick: Math.max(0, cfg.preparationTicks),
      phase: cfg.preparationTicks > 0 ? 'preparation' : 'battle',
    };
  }

  let leftUnit = entityToKecoUnit(session.left);
  let rightUnit = entityToKecoUnit(session.right);

  if (cfg.monsterInitialElement) {
    rightUnit = {
      ...rightUnit,
      element: {
        element: cfg.monsterInitialElement,
        strength: 'weak',
        remainingTurns: 2,
      },
    };
  }

  const keco: KecoCombatExtension = {
    skillById,
    units: {
      [session.left.id]: leftUnit,
      [session.right.id]: rightUnit,
    },
    logs: [],
    turn: 0,
  };

  return { ...session, keco };
}
