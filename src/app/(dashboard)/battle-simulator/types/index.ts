/**
 * Battle Simulator - Type Definitions
 */

/** Combatant type */
export type CombatantType = 'player' | 'monster';

/** Combatant entity */
export interface Combatant {
  id: string;
  name: string;
  /** Health Points */
  hp: number;
  /** Attack */
  atk: number;
  /** Defense */
  def: number;
  /** Speed (determines turn order) */
  spd: number;
  /** Combatant type */
  type: CombatantType;
}

/** Default combatant stats */
export const DEFAULT_PLAYER_STATS = {
  name: 'Player',
  hp: 100,
  atk: 20,
  def: 10,
  spd: 15,
} as const;

export const DEFAULT_MONSTER_STATS = {
  name: 'Goblin',
  hp: 50,
  atk: 15,
  def: 5,
  spd: 10,
} as const;

/** Battle configuration */
export interface BattleConfig {
  player: Combatant;
  monster: Combatant;
  /** Max battle turns (prevents infinite loops) */
  maxTurns: number;
}

/** Turn log entry */
export interface TurnLog {
  turnNumber: number;
  attacker: string;
  defender: string;
  damage: number;
  attackerHpAfter: number;
  defenderHpAfter: number;
  isCritical?: boolean;
}

/** Battle result */
export interface BattleResult {
  winner: 'player' | 'monster' | 'draw';
  totalTurns: number;
  playerFinalHp: number;
  monsterFinalHp: number;
  turns: TurnLog[];
  playerStartingHp: number;
  monsterStartingHp: number;
}

/** Difficulty levels */
export type DifficultyLevel =
  | 'trivial'    // HP > 90%
  | 'easy'       // HP 60-90%
  | 'balanced'   // HP 30-60%
  | 'hard'       // HP 0-30%
  | 'impossible'; // HP = 0

/** Difficulty level metadata */
export const DIFFICULTY_CONFIG: Record<DifficultyLevel, {
  label: string;
  color: string;
  bgColor: string;
  description: string;
  minPercent: number;
  maxPercent: number;
}> = {
  trivial: {
    label: 'Trivial',
    color: '#52c41a',
    bgColor: '#f6ffed',
    description: 'Overwhelming victory',
    minPercent: 0.9,
    maxPercent: 1.0,
  },
  easy: {
    label: 'Easy',
    color: '#1890ff',
    bgColor: '#e6f7ff',
    description: 'Comfortable win',
    minPercent: 0.6,
    maxPercent: 0.9,
  },
  balanced: {
    label: 'Balanced',
    color: '#faad14',
    bgColor: '#fffbe6',
    description: 'Requires effort',
    minPercent: 0.3,
    maxPercent: 0.6,
  },
  hard: {
    label: 'Hard',
    color: '#fa8c16',
    bgColor: '#fff7e6',
    description: 'Narrow win or close loss',
    minPercent: 0,
    maxPercent: 0.3,
  },
  impossible: {
    label: 'Impossible',
    color: '#ff4d4f',
    bgColor: '#fff2f0',
    description: 'Virtually unwinnable',
    minPercent: 0,
    maxPercent: 0,
  },
};

/** Battle statistics summary */
export interface BattleStats {
  totalBattles: number;
  playerWinRate: number;
  averageTurns: number;
  averagePlayerHp: number;
  difficultyDistribution: Record<DifficultyLevel, number>;
}

/** Field mapping configuration */
export interface FieldMapping {
  libraryId: string;
  libraryName: string;
  mappings: {
    libraryFieldId: string;
    libraryFieldName: string;
    battleField: BattleFieldType;
  }[];
}

/** Battle field types that can be mapped */
export type BattleFieldType = 'hp' | 'atk' | 'def' | 'spd' | 'name';

/** Battle field metadata */
export const BATTLE_FIELDS: Record<BattleFieldType, {
  label: string;
  shortLabel: string;
  description: string;
  min: number;
  max: number;
  default: number;
}> = {
  hp: {
    label: 'Health (HP)',
    shortLabel: 'HP',
    description: 'Health points, determines damage taken',
    min: 1,
    max: 99999,
    default: 100,
  },
  atk: {
    label: 'Attack (ATK)',
    shortLabel: 'ATK',
    description: 'Attack power, affects damage dealt',
    min: 1,
    max: 9999,
    default: 20,
  },
  def: {
    label: 'Defense (DEF)',
    shortLabel: 'DEF',
    description: 'Defense, reduces damage taken',
    min: 0,
    max: 9999,
    default: 10,
  },
  spd: {
    label: 'Speed (SPD)',
    shortLabel: 'SPD',
    description: 'Speed, determines turn order',
    min: 1,
    max: 9999,
    default: 15,
  },
  name: {
    label: 'Name',
    shortLabel: 'Name',
    description: 'Combatant name',
    min: 1,
    max: 50,
    default: 0,
  },
};

/** Simulation running status */
export type SimulationStatus = 'idle' | 'running' | 'completed';
