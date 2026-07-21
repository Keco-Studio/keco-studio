/**
 * Battle simulator — shared types and static UI metadata.
 */

export type Element = 'fire' | 'water' | 'thunder' | 'grass' | 'ice';

export type ElementStrength = 'weak' | 'medium' | 'strong';

/** Element wheel + tint (emoji left empty; UI uses icons / color). */
export const ELEMENT_CONFIG: Record<
  Element,
  {
    name: string;
    emoji: string;
    color: string;
    beats?: Element;
    beatenBy?: Element;
  }
> = {
  fire: {
    name: 'Fire',
    emoji: '',
    color: '#ff6b35',
    beats: 'grass',
    beatenBy: 'water',
  },
  water: {
    name: 'Water',
    emoji: '',
    color: '#4dabf7',
    beats: 'fire',
    beatenBy: 'thunder',
  },
  thunder: {
    name: 'Thunder',
    emoji: '',
    color: '#ffd43b',
    beats: 'water',
    beatenBy: 'grass',
  },
  grass: {
    name: 'Grass',
    emoji: '',
    color: '#51cf66',
    beats: 'thunder',
    beatenBy: 'fire',
  },
  ice: {
    name: 'Ice',
    emoji: '',
    color: '#74c0fc',
    beats: 'grass',
    beatenBy: 'fire',
  },
};

export const ELEMENT_STRENGTH_CONFIG: Record<
  ElementStrength,
  {
    name: string;
    duration: number;
    decayRate: number;
  }
> = {
  weak: { name: 'Weak', duration: 2, decayRate: 0.1 },
  medium: { name: 'Medium', duration: 3, decayRate: 0.15 },
  strong: { name: 'Strong', duration: 4, decayRate: 0.2 },
};

export type ReactionType =
  | 'vaporize'
  | 'melt'
  | 'electrify'
  | 'overload'
  | 'burn'
  | 'freeze'
  | 'quicken';

export const REACTION_CONFIG: Record<
  ReactionType,
  {
    name: string;
    emoji: string;
    multiplier?: number;
    extraDamage?: number;
    description: string;
  }
> = {
  vaporize: {
    name: 'Vaporize',
    emoji: '',
    multiplier: 2.0,
    description: 'Fire + Water — 2.0× amplifying damage.',
  },
  melt: {
    name: 'Melt',
    emoji: '',
    multiplier: 2.0,
    description: 'Fire + Ice — 2.0× amplifying damage.',
  },
  electrify: {
    name: 'Electrify',
    emoji: '',
    extraDamage: 0.8,
    description: 'Thunder + Water — extra damage ATK×0.8.',
  },
  overload: {
    name: 'Overload',
    emoji: '',
    extraDamage: 1.0,
    description: 'Thunder + Fire — extra damage ATK×1.0.',
  },
  burn: {
    name: 'Burn',
    emoji: '',
    extraDamage: 0.3,
    description: 'Fire + Grass — DoT ATK×0.3 for 2 turns.',
  },
  freeze: {
    name: 'Freeze',
    emoji: '',
    multiplier: 1.0,
    description: 'Water + Ice — target skips next turn.',
  },
  quicken: {
    name: 'Quicken',
    emoji: '',
    extraDamage: 0.3,
    description: 'Thunder + Grass — +30% Thunder/Grass damage for 2 turns.',
  },
};

export type CombatantType = 'player' | 'monster';

export interface ElementAttachment {
  element: Element;
  strength: ElementStrength;
  remainingTurns: number;
}

export interface DotStatus {
  damage: number;
  remainingTurns: number;
}

export interface Buff {
  type: 'enflame' | 'electrified' | 'quicken' | 'atk_debuff' | 'def_debuff';
  value: number;
  remainingTurns: number;
}

export interface ControlStatus {
  type: 'freeze';
  remainingTurns: number;
}

export interface BattleUnit {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  mp: number;
  maxMp: number;
  type: CombatantType;
  element: ElementAttachment | null;
  dot: DotStatus | null;
  buffs: Buff[];
  control: ControlStatus | null;
}

export interface Combatant {
  id: string;
  name: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  mp: number;
  type: CombatantType;
}

export type SkillType = 'attack' | 'heal';

export interface Skill {
  id: string;
  name: string;
  type: SkillType;
  power: number;
  mpCost: number;
  cooldown: number;
  maxCooldown: number;
  attachElement?: {
    element: Element | 'random';
    strength: ElementStrength;
    duration: number;
  };
  dot?: {
    damage: number;
    duration: number;
  };
  crowdControl?: {
    type: 'freeze';
    duration: number;
  };
  specialEffect?: {
    type: 'atk_debuff' | 'def_debuff' | 'heal';
    value: number;
    duration: number;
  };
  reactionTrigger?: {
    element: Element;
    reaction: ReactionType;
  }[];
  description: string;
}

export enum SkillId {
  PUGONG_MENGJI = 'pugong_mengji',
  PUGONG_YUANSU_CHUOCI = 'pugong_yuansu_chuoci',
  PUGONG_XUHOU_ZAN = 'pugong_xuhou_zan',
  HUO_XIAOHUODAN = 'huo_xiaohuodan',
  HUO_HUOYAN_ZHAN = 'huo_huoyan_zhan',
  HUO_RANHUO_CHONGJI = 'huo_ranhuo_chongji',
  HUO_LIAOYUAN_HUO = 'huo_liaoyuan_huo',
  HUO_YANBAO = 'huo_yanbao',
  HUO_JINMIE_JI = 'huo_jinmie_ji',
  SHUI_SHUIDAN = 'shui_shuidan',
  SHUI_LANGYONG = 'shui_langyong',
  SHUI_BINGDONG_SHUIJIAN = 'shui_bingdong_shuijian',
  SHUI_HONGLIU = 'shui_hongliu',
  SHUI_SHUISHI_BO = 'shui_shuishi_bo',
  SHUI_CANGLAN_PO = 'shui_canglan_po',
  LEI_LEIHU = 'lei_leihu',
  LEI_JINGLEI_SHAN = 'lei_jinglei_shan',
  LEI_LEITENG_JI = 'lei_leiteng_ji',
  LEI_KUANGLEI = 'lei_kuanglei',
  LEI_LEIJI = 'lei_leiji',
  LEI_TIANFA_LEI = 'lei_tianfa_lei',
  CAO_TENGBIAN = 'cao_tengbian',
  CAO_JINGJI_TU = 'cao_jingji_tu',
  CAO_MANSHENG = 'cao_mansheng',
  CAO_RONGKU_SHU = 'cao_rongku_shu',
  CAO_LINGCAO_YU = 'cao_lingcao_yu',
  CAO_WANTENG_JIAO = 'cao_wanteng_jiao',
  BING_BINGCI = 'bing_bingci',
  BING_BINGLENG_ZAN = 'bing_bingleng_zan',
  BING_YONGHAN_YU = 'bing_yonghan_yu',
}

export type LogType =
  | 'turn_start'
  | 'turn_end'
  | 'skill_use'
  | 'damage'
  | 'heal'
  | 'element_attach'
  | 'element_reaction'
  | 'dot_damage'
  | 'dot_expire'
  | 'buff_add'
  | 'buff_expire'
  | 'control'
  | 'control_expire'
  | 'mp_cost'
  | 'mp_recover'
  | 'battle_start'
  | 'battle_end';

export interface BattleLogEntry {
  id: string;
  turn: number;
  type: LogType;
  actor?: string;
  target?: string;
  skillName?: string;
  damage?: number;
  healAmount?: number;
  element?: Element;
  reaction?: ReactionType;
  dotDamage?: number;
  mpChange?: number;
  statusText?: string;
  color?: string;
}

export type BattlePhase = 'setup' | 'player_turn' | 'enemy_turn' | 'round_end' | 'finished';

export type BattleResult = 'player_win' | 'monster_win' | 'draw';

export interface BattleConfig {
  player: Combatant;
  monster: Combatant;
  monsterInitialElement?: Element;
  maxTurns: number;
}

export interface BattleState {
  phase: BattlePhase;
  currentTurn: number;
  player: BattleUnit;
  monster: BattleUnit;
  selectedSkill: Skill | null;
  skillCooldowns: Record<string, number>;
  battleLogs: BattleLogEntry[];
  result: BattleResult | null;
}

export const DEFAULT_PLAYER_STATS = {
  name: 'Player',
  hp: 1000,
  atk: 150,
  def: 80,
  spd: 100,
  mp: 100,
} as const;

export const DEFAULT_MONSTER_STATS = {
  name: 'Slime',
  hp: 800,
  atk: 120,
  def: 60,
  spd: 90,
  mp: 80,
} as const;

export const MP_CONFIG = {
  initialMp: 100,
  maxMp: 100,
  mpPerTurn: 10,
  mpOnKill: 20,
} as const;
