/**
 * Battle Engine - Re-exports from shared battle logic
 * All core logic is now in battleLogic.ts (single source of truth)
 */

// Re-export all public APIs from shared logic
export {
  calculateDamage,
  determineFirstAttacker,
  calculateDifficulty,
  simulateBattle,
  runBatchSimulation,
  calculateStats,
  formatBattleResult,
} from './battleLogic';

export type {
  Combatant,
  BattleConfig,
  TurnLog,
  BattleResult,
  BattleStats,
} from './battleLogic';
