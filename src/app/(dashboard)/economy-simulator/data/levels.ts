/**
 * 关卡数据 - Level Data
 * 基于《少三2》关卡表
 */

import type { Level, LevelType } from '../types';

/** 关卡列表 */
export const LEVELS: Level[] = [
  {
    id: 100001,
    name: '初入三国',
    type: '主线剧情',
    cost: '体力：15点',
    reward: '升阶装备、经验书、进阶石、银币、主角经验、元宝',
  },
  {
    id: 100002,
    name: '汜水关之战',
    type: '主线剧情',
    cost: '体力：25点',
    reward: '升阶装备、经验书、进阶石、银币、主角经验、元宝',
  },
  {
    id: 100003,
    name: '三英战吕布',
    type: '主线剧情',
    cost: '体力：30点',
    reward: '升阶装备、经验书、进阶石、银币、主角经验、元宝',
  },
  {
    id: 100004,
    name: '洛阳鏖战',
    type: '主线剧情',
    cost: '体力：40点',
    reward: '升阶装备、经验书、进阶石、银币、主角经验、元宝',
  },
  {
    id: 100005,
    name: '袁绍的野心',
    type: '主线剧情',
    cost: '体力：30点',
    reward: '升阶装备、经验书、进阶石、银币、主角经验、元宝',
  },
  {
    id: 100006,
    name: '曹营风波',
    type: '主线剧情',
    cost: '体力：50点',
    reward: '升阶装备、经验书、进阶石、银币、主角经验、元宝',
  },
  {
    id: 100007,
    name: '孙坚的考验',
    type: '主线剧情',
    cost: '体力：50点',
    reward: '升阶装备、经验书、进阶石、银币、主角经验、元宝',
  },
  {
    id: 100008,
    name: '曹操的计策',
    type: '主线剧情',
    cost: '体力：50点',
    reward: '升阶装备、经验书、进阶石、银币、主角经验、元宝',
  },
  {
    id: 100009,
    name: '无双试炼',
    type: '征战副本',
    cost: '无双试炼重置次数：1次',
    reward: '威名货币、银币、装备宝箱',
  },
  {
    id: 100010,
    name: '刘备传',
    type: '列传副本',
    cost: '无消耗',
    reward: '经验书、主角经验、银币、解锁阵容增益',
  },
];

/** 关卡类型配置 */
export const LEVEL_TYPE_CONFIG: Record<LevelType, { label: string; color: string }> = {
  '主线剧情': { label: '主线 / Main', color: '#1890ff' },
  '征战副本': { label: '副本 / Dungeon', color: '#fa8c16' },
  '列传副本': { label: '列传 / Story', color: '#52c41a' },
  '无双试炼': { label: '试炼 / Trial', color: '#722ed1' },
};

/** 体力配置 */
export const STAMINA_CONFIG = {
  /** 每日自然恢复 */
  dailyRecovery: 120,
  /** 自然恢复间隔(分钟) */
  recoveryInterval: 6,
  /** 最大体力上限 */
  maxStamina: 120,
  /** 体力恢复元宝价格 */
  recoverCost: 10,
};

/**
 * 根据ID获取关卡
 */
export function getLevelById(id: number): Level | undefined {
  return LEVELS.find(l => l.id === id);
}

/**
 * 根据类型获取关卡
 */
export function getLevelsByType(type: LevelType): Level[] {
  return LEVELS.filter(l => l.type === type);
}

/**
 * 解析关卡消耗
 * @param costStr 消耗描述字符串
 */
export function parseLevelCost(costStr: string): { type: string; amount: number } | null {
  if (costStr === '无消耗') {
    return { type: 'none', amount: 0 };
  }
  
  const staminaMatch = costStr.match(/体力[：:]\s*(\d+)/);
  if (staminaMatch) {
    return { type: 'stamina', amount: parseInt(staminaMatch[1]) };
  }
  
  const resetMatch = costStr.match(/重置次数[：:]\s*(\d+)/);
  if (resetMatch) {
    return { type: 'reset', amount: parseInt(resetMatch[1]) };
  }
  
  return null;
}

/**
 * 计算关卡收益（简化计算）
 * @param level 关卡
 * @param playerLevel 主将等级
 */
export function calculateLevelReward(level: Level, playerLevel: number): {
  silver: number;
  exp: number;
  gold: number;
} {
  // 基础收益与等级相关
  const baseMultiplier = Math.pow(1.1, playerLevel - 1);
  
  switch (level.type) {
    case '主线剧情': {
      const baseSilver = 500;
      const baseExp = 100;
      const baseGold = 10;
      return {
        silver: Math.floor(baseSilver * baseMultiplier),
        exp: Math.floor(baseExp * baseMultiplier),
        gold: Math.floor(baseGold * baseMultiplier),
      };
    }
    case '征战副本': {
      const baseSilver = 1000;
      const baseExp = 50;
      const baseGold = 5;
      return {
        silver: Math.floor(baseSilver * baseMultiplier),
        exp: Math.floor(baseExp * baseMultiplier),
        gold: Math.floor(baseGold * baseMultiplier),
      };
    }
    case '列传副本': {
      const baseSilver = 300;
      const baseExp = 200;
      const baseGold = 0;
      return {
        silver: Math.floor(baseSilver * baseMultiplier),
        exp: Math.floor(baseExp * baseMultiplier),
        gold: 0,
      };
    }
    case '无双试炼': {
      const baseSilver = 800;
      const baseExp = 80;
      const baseGold = 15;
      return {
        silver: Math.floor(baseSilver * baseMultiplier),
        exp: Math.floor(baseExp * baseMultiplier),
        gold: Math.floor(baseGold * baseMultiplier),
      };
    }
    default:
      return { silver: 0, exp: 0, gold: 0 };
  }
}

/**
 * 计算通关所需体力
 */
export function calculateTotalStaminaCost(levelIds: number[]): number {
  let total = 0;
  for (const id of levelIds) {
    const level = getLevelById(id);
    if (level) {
      const cost = parseLevelCost(level.cost);
      if (cost && cost.type === 'stamina') {
        total += cost.amount;
      }
    }
  }
  return total;
}

/**
 * 计算体力恢复时间
 * @param currentStamina 当前体力
 * @param targetStamina 目标体力
 */
export function calculateRecoveryTime(currentStamina: number, targetStamina: number): number {
  if (currentStamina >= targetStamina) return 0;
  
  const needed = targetStamina - currentStamina;
  const minutes = needed * STAMINA_CONFIG.recoveryInterval;
  
  return minutes;
}

/**
 * 格式化时间为友好显示
 * @param minutes 分钟数
 */
export function formatRecoveryTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}分钟 / ${minutes}min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours < 24) {
    return `${hours}小时${mins > 0 ? `${mins}分钟` : ''} / ${hours}h${mins > 0 ? `${mins}m` : ''}`;
  }
  
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  
  return `${days}天${remainingHours > 0 ? `${remainingHours}小时` : ''} / ${days}d${remainingHours > 0 ? `${remainingHours}h` : ''}`;
}
