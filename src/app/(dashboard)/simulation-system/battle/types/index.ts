/**
 * Battle Simulator - Type Definitions
 * 战斗系统类型定义
 */

// ==================== 元素系统 ====================

/** 元素类型 */
export type Element = 'fire' | 'water' | 'thunder' | 'grass' | 'ice';

/** 元素强度 */
export type ElementStrength = 'weak' | 'medium' | 'strong';

/** 元素配置 */
export const ELEMENT_CONFIG: Record<Element, {
  name: string;
  emoji: string;
  color: string;
  beats?: Element;  // 克谁
  beatenBy?: Element;  // 被谁克
}> = {
  fire: {
    name: '火',
    emoji: '🔥',
    color: '#ff6b35',
    beats: 'grass',
    beatenBy: 'water',
  },
  water: {
    name: '水',
    emoji: '💧',
    color: '#4dabf7',
    beats: 'fire',
    beatenBy: 'thunder',
  },
  thunder: {
    name: '雷',
    emoji: '⚡',
    color: '#ffd43b',
    beats: 'water',
    beatenBy: 'grass',
  },
  grass: {
    name: '草',
    emoji: '🌿',
    color: '#51cf66',
    beats: 'thunder',
    beatenBy: 'fire',
  },
  ice: {
    name: '冰',
    emoji: '❄️',
    color: '#74c0fc',
    beats: 'grass',
    beatenBy: 'fire',
  },
};

/** 元素强度配置 */
export const ELEMENT_STRENGTH_CONFIG: Record<ElementStrength, {
  name: string;
  duration: number;  // 持续回合
  decayRate: number;  // 衰减率
}> = {
  weak: { name: '弱', duration: 2, decayRate: 0.10 },
  medium: { name: '中', duration: 3, decayRate: 0.15 },
  strong: { name: '强', duration: 4, decayRate: 0.20 },
};

// ==================== 元素反应 ====================

/** 反应类型 */
export type ReactionType = 
  | 'vaporize'    // 蒸发
  | 'melt'        // 融化
  | 'electrify'   // 感电
  | 'overload'    // 超载
  | 'burn'        // 燃烧
  | 'freeze'      // 冻结
  | 'quicken';    // 激化

/** 元素反应配置 */
export const REACTION_CONFIG: Record<ReactionType, {
  name: string;
  emoji: string;
  multiplier: number;  // 倍率（增幅反应）
  extraDamage?: number;  // 额外伤害（剧变反应）
  description: string;
}> = {
  vaporize: {
    name: '蒸发',
    emoji: '💥',
    multiplier: 2.0,
    description: '火+水，造成 2.0× 增幅伤害',
  },
  melt: {
    name: '融化',
    emoji: '💥',
    multiplier: 2.0,
    description: '火+冰，造成 2.0× 增幅伤害',
  },
  electrify: {
    name: '感电',
    emoji: '⚡',
    extraDamage: 0.8,
    description: '雷+水，造成 ATK×0.8 额外伤害',
  },
  overload: {
    name: '超载',
    emoji: '💥',
    extraDamage: 1.0,
    description: '雷+火，造成 ATK×1.0 额外伤害',
  },
  burn: {
    name: '燃烧',
    emoji: '🔥',
    extraDamage: 0.3,
    description: '火+草，造成 ATK×0.3 持续伤害（2回合）',
  },
  freeze: {
    name: '冻结',
    emoji: '❄️',
    multiplier: 1.0,
    description: '水+冰，目标跳过下回合',
  },
  quicken: {
    name: '激化',
    emoji: '✨',
    extraDamage: 0.3,
    description: '雷+草，后续雷/草伤害 +30%（2回合）',
  },
};

// ==================== 战斗单位 ====================

/** 战斗单位类型 */
export type CombatantType = 'player' | 'monster';

/** 元素附着状态 */
export interface ElementAttachment {
  element: Element;
  strength: ElementStrength;
  remainingTurns: number;
}

/** DOT 持续伤害状态 */
export interface DotStatus {
  damage: number;  // 每回合伤害倍率
  remainingTurns: number;
}

/** Buff 效果 */
export interface Buff {
  type: 'enflame' | 'electrified' | 'quicken' | 'atk_debuff' | 'def_debuff';
  value: number;
  remainingTurns: number;
}

/** 控制状态 */
export interface ControlStatus {
  type: 'freeze';
  remainingTurns: number;
}

/** 战斗单位 */
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
  // 状态
  element: ElementAttachment | null;
  dot: DotStatus | null;
  buffs: Buff[];
  control: ControlStatus | null;
}

/** 原始战斗单位（用于配置） */
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

// ==================== 技能系统 ====================

/** 技能类型 */
export type SkillType = 'attack' | 'heal';

/** 技能 */
export interface Skill {
  id: string;
  name: string;
  type: SkillType;
  power: number;  // 伤害倍率
  mpCost: number;  // MP 消耗
  cooldown: number;  // 当前冷却
  maxCooldown: number;  // 最大冷却
  attachElement?: {
    element: Element | 'random';
    strength: ElementStrength;
    duration: number;
  };
  dot?: {
    damage: number;  // DOT 伤害倍率
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

/** 技能 ID 枚举 */
export enum SkillId {
  // 普攻
  PUGONG_MENGJI = 'pugong_mengji',
  PUGONG_YUANSU_CHUOCI = 'pugong_yuansu_chuoci',
  PUGONG_XUHOU_ZAN = 'pugong_xuhou_zan',
  // 火系
  HUO_XIAOHUODAN = 'huo_xiaohuodan',
  HUO_HUOYAN_ZHAN = 'huo_huoyan_zhan',
  HUO_RANHUO_CHONGJI = 'huo_ranhuo_chongji',
  HUO_LIAOYUAN_HUO = 'huo_liaoyuan_huo',
  HUO_YANBAO = 'huo_yanbao',
  HUO_JINMIE_JI = 'huo_jinmie_ji',
  // 水系
  SHUI_SHUIDAN = 'shui_shuidan',
  SHUI_LANGYONG = 'shui_langyong',
  SHUI_BINGDONG_SHUIJIAN = 'shui_bingdong_shuijian',
  SHUI_HONGLIU = 'shui_hongliu',
  SHUI_SHUISHI_BO = 'shui_shuishi_bo',
  SHUI_CANGLAN_PO = 'shui_canglan_po',
  // 雷系
  LEI_LEIHU = 'lei_leihu',
  LEI_JINGLEI_SHAN = 'lei_jinglei_shan',
  LEI_LEITENG_JI = 'lei_leiteng_ji',
  LEI_KUANGLEI = 'lei_kuanglei',
  LEI_LEIJI = 'lei_leiji',
  LEI_TIANFA_LEI = 'lei_tianfa_lei',
  // 草系
  CAO_TENGBIAN = 'cao_tengbian',
  CAO_JINGJI_TU = 'cao_jingji_tu',
  CAO_MANSHENG = 'cao_mansheng',
  CAO_RONGKU_SHU = 'cao_rongku_shu',
  CAO_LINGCAO_YU = 'cao_lingcao_yu',
  CAO_WANTENG_JIAO = 'cao_wanteng_jiao',
  // 冰系
  BING_BINGCI = 'bing_bingci',
  BING_BINGLENG_ZAN = 'bing_bingleng_zan',
  BING_YONGHAN_YU = 'bing_yonghan_yu',
}

// ==================== 战斗日志 ====================

/** 日志类型 */
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

/** 战斗日志条目 */
export interface BattleLogEntry {
  id: string;
  turn: number;
  type: LogType;
  actor?: string;  // 行动者
  target?: string;  // 目标
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

// ==================== 战斗状态 ====================

/** 战斗阶段 */
export type BattlePhase = 
  | 'setup'        // 设置阶段
  | 'player_turn'  // 玩家回合
  | 'enemy_turn'   // 敌人回合
  | 'round_end'    // 回合结束
  | 'finished';    // 战斗结束

/** 战斗结果 */
export type BattleResult = 'player_win' | 'monster_win' | 'draw';

/** 战斗配置 */
export interface BattleConfig {
  player: Combatant;
  monster: Combatant;
  monsterInitialElement?: Element;  // 敌人初始元素
  maxTurns: number;
}

/** 战斗状态 */
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

// ==================== 默认值配置 ====================

/** 默认玩家属性 */
export const DEFAULT_PLAYER_STATS = {
  name: '玩家',
  hp: 1000,
  atk: 150,
  def: 80,
  spd: 100,
  mp: 100,
} as const;

/** 默认敌人属性 */
export const DEFAULT_MONSTER_STATS = {
  name: '史莱姆',
  hp: 800,
  atk: 120,
  def: 60,
  spd: 90,
  mp: 80,
} as const;

/** MP 配置 */
export const MP_CONFIG = {
  initialMp: 100,
  maxMp: 100,
  mpPerTurn: 10,  // 每回合恢复 MP
  mpOnKill: 20,   // 击杀恢复 MP
} as const;
