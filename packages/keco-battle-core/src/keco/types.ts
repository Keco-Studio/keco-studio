import type { BattleLogEntry, BattleUnit, Skill } from '@keco/battle-engine';

export type KecoCombatExtension = {
  skillById: Record<string, Skill>;
  units: Record<string, BattleUnit>;
  logs: BattleLogEntry[];
  turn: number;
};
