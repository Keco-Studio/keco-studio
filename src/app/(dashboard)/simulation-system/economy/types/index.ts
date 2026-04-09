/**
 * 经济模拟系统 - 类型定义
 * Economy Simulator - Type Definitions
 */

// ==================== 角色系统类型 ====================

/** 阵营枚举 */
export type Camp = '魏国' | '蜀国' | '吴国' | '群雄';

/** 稀有度枚举 */
export type Rarity = 1 | 2 | 3;

/** 角色基础属性 */
export interface CharacterBaseStats {
  /** 基础攻击 */
  atk: number;
  /** 基础生命 */
  life: number;
  /** 基础物理防御 */
  def: number;
  /** 基础魔法防御 */
  mdf: number;
}

/** 武将/角色 */
export interface Character {
  /** 武将ID */
  id: number;
  /** 武将名字 */
  name: string;
  /** 稀有度 */
  rarity: Rarity;
  /** 资质 */
  int: number;
  /** 阵营 */
  camp: Camp;
  /** 基础属性 */
  baseStats: CharacterBaseStats;
  /** 天赋ID列表 */
  talentIds: number[];
  /** 技能ID列表 */
  skillIds: number[];
}

/** 天赋 */
export interface Talent {
  /** 天赋ID */
  id: number;
  /** 天赋名 */
  name: string;
  /** 开启阶段 */
  level: number;
  /** 天赋效果描述 */
  effect: string;
}

/** 技能 */
export interface Skill {
  /** 技能ID */
  id: number;
  /** 技能名 */
  name: string;
  /** 技能类型: 普攻/怒气 */
  type: '普攻' | '怒气';
  /** 技能描述 */
  description: string;
}

// ==================== 装备系统类型 ====================

/** 装备品质 */
export type EquipmentQuality = '普通' | '高级' | '神铸';

/** 装备类型 */
export type EquipmentSlot = '苦无' | '手里剑' | '卷轴' | '护额' | '胸甲' | '风衣' | '靴' | '腰带';

/** 装备 */
export interface Equipment {
  /** 装备ID */
  id: number;
  /** 装备名 */
  name: string;
  /** 主类型 */
  mainType: number;
  /** 次类型 (1=武器, 2=头盔, 3=胸甲, 4=披风, 5=鞋子, 6=腰带) */
  subType: number;
  /** 等级 */
  level: number;
  /** 品阶 (1-7) */
  quality: number;
  /** 装备品质文字 */
  qualityText: EquipmentQuality;
  /** 强化费用 */
  enhanceCost: number;
  /** 打造银币消耗 */
  craftCost: number;
  /** 开放等级 */
  openLevel: number;
}

// ==================== 竞技场类型 ====================

/** 竞技场排名数据 */
export interface ArenaRankData {
  /** 排名 */
  rank: number;
  /** 声望奖励 */
  prestigeReward: number;
  /** 银币奖励 */
  silverReward: number;
}

/** 竞技场奖励配置 */
export interface ArenaRewardConfig {
  /** 每日购买次数 */
  dailyPurchaseCount: number;
  /** 竞技场胜率 */
  winRate: number;
}

// ==================== 关卡系统类型 ====================

/** 关卡类型 */
export type LevelType = '主线剧情' | '征战副本' | '列传副本' | '无双试炼';

/** 关卡 */
export interface Level {
  /** 关卡ID */
  id: number;
  /** 关卡名 */
  name: string;
  /** 关卡类型 */
  type: LevelType;
  /** 关卡消耗 */
  cost: string;
  /** 关卡奖励 */
  reward: string;
}

// ==================== 忍阶声望类型 ====================

/** 忍阶数据 */
export interface PrestigeLevel {
  /** 忍阶等级 */
  level: number;
  /** 忍阶名称 */
  name: string;
  /** 升级需要声望 */
  requiredPrestige: number;
  /** 每日扣除声望 */
  dailyCost: number;
  /** 银币奖励 */
  silverReward: number;
  /** 奥义奖励 */
  ultimateReward: number;
  /** 单场胜利所得声望 */
  winPrestige: number;
  /** 斗技场失败系数 */
  loseCoefficient: number;
  /** 每日获得声望 */
  dailyGain: number;
}

// ==================== 玩家等级经验类型 ====================

/** 等级阶段 */
export type LevelTier = 'beginner' | 'growth' | 'mid' | 'late' | 'end' | 'apex';

/** 玩家等级数据 */
export interface PlayerLevelData {
  /** 等级 */
  level: number;
  /** 升级所需经验 */
  expToNext: number;
  /** 累计经验 */
  cumulativeExp: number;
  /** 所属阶段 */
  tier: LevelTier;
}

// ==================== 计算器类型 ====================

/** 收益计算结果 */
export interface RevenueResult {
  /** 银币收益 */
  silver: number;
  /** 声望收益 */
  prestige: number;
  /** 经验收益 */
  exp: number;
  /** 元宝收益 */
  gold: number;
  /** 装备宝箱 */
  equipmentChest?: number;
}

/** 消耗计算结果 */
export interface CostResult {
  /** 体力消耗 */
  stamina: number;
  /** 时间消耗(分钟) */
  time: number;
}

/** 模拟配置 */
export interface SimulatorConfig {
  /** 主将等级 */
  playerLevel: number;
  /** 忍阶等级 */
  prestigeLevel: number;
  /** 竞技场排名 */
  arenaRank: number;
  /** 每日挑战次数 */
  dailyChallenges: number;
  /** 胜率 */
  winRate: number;
}

// ==================== 常量配置 ====================

/** 属性类型 */
export type StatType = 'atk' | 'life' | 'def' | 'mdf';

/** 属性配置 */
export const STAT_CONFIG: Record<StatType, { label: string; labelCn: string }> = {
  atk: { label: 'ATK', labelCn: '攻击' },
  life: { label: 'HP', labelCn: '生命' },
  def: { label: 'DEF', labelCn: '物理防御' },
  mdf: { label: 'MDF', labelCn: '魔法防御' },
};

/** 品质颜色配置 */
export const QUALITY_COLORS: Record<number, string> = {
  1: '#8c8c8c', // 普通 - 灰色
  2: '#52c41a', // 高级 - 绿色
  3: '#1890ff', // 蓝色
  4: '#722ed1', // 紫色
  5: '#fa8c16', // 橙色
  6: '#f5222d', // 红色
  7: '#eb2f96', // 粉色
};

/** 阵营颜色配置 */
export const CAMP_COLORS: Record<Camp, string> = {
  '魏国': '#9c27b0',
  '蜀国': '#4caf50',
  '吴国': '#2196f3',
  '群雄': '#ff9800',
};

/** 稀有度配置 */
export const RARITY_CONFIG: Record<Rarity, { label: string; color: string }> = {
  1: { label: '普通', color: '#8c8c8c' },
  2: { label: '稀有', color: '#1890ff' },
  3: { label: '史诗', color: '#722ed1' },
};
