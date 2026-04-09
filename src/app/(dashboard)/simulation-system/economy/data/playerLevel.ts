/**
 * 等级经验数据 - Player Level Experience Data
 * 基于游戏设计中的边际效用曲线
 * 
 * 设计原则：
 * 1. 低等级（1-30）：对数-平方根混合，快速升级保持新手体验
 * 2. 中等级（31-80）：平方根-线性混合，稳定增长保持参与感
 * 3. 高等级（81-150）：线性增长，稳步前进
 * 4. 巅峰（151-200）：指数增长，延长生命周期
 * 
 * 核心公式：结合多种函数特性
 * - 对数：前期快速增长但边际递减
 * - 平方根：平滑过渡
 * - 线性：稳定增长
 * - 指数：后期爆炸式增长
 */

import type { PlayerLevelData } from '../types';

/** 经验曲线模型类型 */
export type ExpCurveModel = 'logarithmic' | 'sqrt' | 'linear' | 'exponential';

/** 经验曲线阶段配置 */
export const EXP_CURVE_STAGES = {
  /** 新手阶段：1-30级，对数-平方根混合 */
  beginner: { 
    minLevel: 1, 
    maxLevel: 30, 
    label: '新手期', 
    model: 'logarithmic' as ExpCurveModel,
    baseExp: 50,
    growthFactor: 1.08,
  },
  /** 成长阶段：31-60级，平方根模型 */
  growth: { 
    minLevel: 31, 
    maxLevel: 60, 
    label: '成长期', 
    model: 'sqrt' as ExpCurveModel,
    baseExp: 300,
    growthFactor: 1.15,
  },
  /** 中级阶段：61-100级，平方根-线性过渡 */
  mid: { 
    minLevel: 61, 
    maxLevel: 100, 
    label: '中期', 
    model: 'sqrt' as ExpCurveModel,
    baseExp: 1500,
    growthFactor: 1.20,
  },
  /** 高级阶段：101-140级，线性增长 */
  late: { 
    minLevel: 101, 
    maxLevel: 140, 
    label: '后期', 
    model: 'linear' as ExpCurveModel,
    baseExp: 8000,
    growthFactor: 1.25,
  },
  /** 终级阶段：141-170级，线性-指数过渡 */
  end: { 
    minLevel: 141, 
    maxLevel: 170, 
    label: '终期', 
    model: 'linear' as ExpCurveModel,
    baseExp: 50000,
    growthFactor: 1.35,
  },
  /** 巅峰阶段：171-200级，指数爆炸 */
  apex: { 
    minLevel: 171, 
    maxLevel: 200, 
    label: '巅峰', 
    model: 'exponential' as ExpCurveModel,
    baseExp: 300000,
    growthFactor: 1.45,
  },
} as const;

/**
 * 经验曲线计算函数
 * @param level 等级
 * @param stage 阶段配置
 * @param levelInStage 阶段内等级（从0开始）
 */
function calculateExpForLevel(
  level: number, 
  stage: typeof EXP_CURVE_STAGES[keyof typeof EXP_CURVE_STAGES],
  levelInStage: number
): number {
  const { model, baseExp, growthFactor } = stage;
  
  switch (model) {
    case 'logarithmic':
      // 对数模型：前期快，后期慢
      // 公式：baseExp * (1 + log(level) * growthFactor)
      return Math.floor(baseExp * (1 + Math.log(level) * growthFactor));
    
    case 'sqrt':
      // 平方根模型：平滑增长
      // 公式：baseExp * (1 + sqrt(levelInStage) * growthFactor)
      return Math.floor(baseExp * (1 + Math.sqrt(levelInStage + 1) * growthFactor));
    
    case 'linear':
      // 线性模型：稳定增长
      // 公式：baseExp * (1 + levelInStage * growthFactor / 10)
      return Math.floor(baseExp * (1 + levelInStage * growthFactor / 10));
    
    case 'exponential':
      // 指数模型：后期爆炸增长
      // 公式：baseExp * pow(growthFactor, levelInStage)
      return Math.floor(baseExp * Math.pow(growthFactor, levelInStage));
    
    default:
      return Math.floor(baseExp * growthFactor);
  }
}

/**
 * 预计算的等级经验表（1-200级）
 */
export const PLAYER_LEVELS: PlayerLevelData[] = [];

/**
 * 生成等级经验表
 */
function generateLevelExpTable(): void {
  let cumulativeExp = 0;
  
  for (let level = 1; level <= 200; level++) {
    // 找到当前等级所属的阶段
    const stage = getExpCurveStage(level);
    const levelInStage = level - stage.minLevel;
    
    // 计算当前等级所需经验
    let expForLevel = calculateExpForLevel(level, stage, levelInStage);
    
    // 确保经验单调递增（如果计算结果小于上一级，则使用上一级的1.05倍）
    const lastLevelExp = PLAYER_LEVELS.length > 0 
      ? PLAYER_LEVELS[PLAYER_LEVELS.length - 1].expToNext 
      : 0;
    if (expForLevel < lastLevelExp * 0.9) {
      expForLevel = Math.floor(lastLevelExp * 1.08);
    }
    
    cumulativeExp += expForLevel;
    
    PLAYER_LEVELS.push({
      level,
      expToNext: expForLevel,
      cumulativeExp,
      tier: getLevelTier(level),
    });
  }
}

/**
 * 获取等级对应的曲线阶段
 */
export function getExpCurveStage(level: number): typeof EXP_CURVE_STAGES[keyof typeof EXP_CURVE_STAGES] {
  if (level <= 30) return EXP_CURVE_STAGES.beginner;
  if (level <= 60) return EXP_CURVE_STAGES.growth;
  if (level <= 100) return EXP_CURVE_STAGES.mid;
  if (level <= 140) return EXP_CURVE_STAGES.late;
  if (level <= 170) return EXP_CURVE_STAGES.end;
  return EXP_CURVE_STAGES.apex;
}

/**
 * 获取等级所属阶段（简化版，用于UI显示）
 */
export const LEVEL_TIERS = {
  /** 新手期：1-30级 */
  beginner: { minLevel: 1, maxLevel: 30, label: '新手期' },
  /** 成长期：31-60级 */
  growth: { minLevel: 31, maxLevel: 60, label: '成长期' },
  /** 中期：61-100级 */
  mid: { minLevel: 61, maxLevel: 100, label: '中期' },
  /** 后期：101-140级 */
  late: { minLevel: 101, maxLevel: 140, label: '后期' },
  /** 终期：141-170级 */
  end: { minLevel: 141, maxLevel: 170, label: '终期' },
  /** 巅峰：171-200级 */
  apex: { minLevel: 171, maxLevel: 200, label: '巅峰' },
} as const;

/**
 * 获取等级所属阶段
 */
export function getLevelTier(level: number): keyof typeof LEVEL_TIERS {
  if (level <= 30) return 'beginner';
  if (level <= 60) return 'growth';
  if (level <= 100) return 'mid';
  if (level <= 140) return 'late';
  if (level <= 170) return 'end';
  return 'apex';
}

/**
 * 获取阶段配置
 */
export function getTierConfig(tier: keyof typeof LEVEL_TIERS) {
  return LEVEL_TIERS[tier];
}

/**
 * 根据等级获取经验数据
 */
export function getLevelData(level: number): PlayerLevelData | undefined {
  if (level < 1 || level > 200) return undefined;
  return PLAYER_LEVELS[level - 1];
}

/**
 * 根据累计经验获取等级
 * @param totalExp 累计获得经验
 */
export function getLevelByExp(totalExp: number): number {
  if (totalExp <= 0) return 1;
  
  // 二分查找优化
  let low = 1;
  let high = 200;
  
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const levelData = PLAYER_LEVELS[mid - 1];
    
    if (levelData.cumulativeExp <= totalExp) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  
  return low;
}

/**
 * 计算从当前等级到目标等级所需经验
 * @param currentLevel 当前等级
 * @param targetLevel 目标等级
 */
export function calcExpToLevel(currentLevel: number, targetLevel: number): number {
  if (currentLevel >= targetLevel) return 0;
  
  let total = 0;
  for (let lv = currentLevel + 1; lv <= targetLevel; lv++) {
    const levelData = getLevelData(lv);
    if (levelData) {
      total += levelData.expToNext;
    }
  }
  return total;
}

/**
 * 计算当前等级进度
 * @param currentLevel 当前等级
 * @param currentExp 当前累计经验
 */
export function calcLevelProgress(currentLevel: number, currentExp: number): {
  progress: number;       // 0-1 进度
  expToNext: number;       // 升级所需经验
  expGained: number;       // 当前已获经验
  expNeeded: number;       // 距离升级还差经验
} {
  const levelData = getLevelData(currentLevel);
  if (!levelData) {
    return { progress: 1, expToNext: 0, expGained: 0, expNeeded: 0 };
  }
  
  // 当前等级起点经验
  const levelStartExp = currentLevel > 1 
    ? PLAYER_LEVELS[currentLevel - 2].cumulativeExp 
    : 0;
  
  const expGained = currentExp - levelStartExp;
  const expToNext = levelData.expToNext;
  const progress = Math.min(1, expGained / expToNext);
  const expNeeded = Math.max(0, expToNext - expGained);
  
  return { progress, expToNext, expGained, expNeeded };
}

/**
 * 计算每日可获得经验（根据关卡配置）
 */
export function calcDailyExp(
  playerLevel: number,
  dailyStamina: number,
  staminaPerLevel: number
): number {
  // 根据玩家等级计算收益系数
  const levelData = getLevelData(playerLevel);
  const tier = levelData?.tier || 'beginner';
  
  // 不同阶段关卡收益倍率
  const tierMultipliers: Record<keyof typeof LEVEL_TIERS, number> = {
    beginner: 1.0,
    growth: 1.3,
    mid: 1.8,
    late: 2.5,
    end: 3.5,
    apex: 5.0,
  };
  
  // 基础经验（根据体力消耗）
  const baseExpPerStamina = 8;
  
  // 计算每日可通关次数
  const dailyRuns = Math.floor(dailyStamina / staminaPerLevel);
  
  // 基础经验收益
  const baseExp = dailyRuns * staminaPerLevel * baseExpPerStamina;
  
  // 应用阶段倍率
  return Math.floor(baseExp * tierMultipliers[tier]);
}

/**
 * 估算升级时间（天）
 * @param currentLevel 当前等级
 * @param dailyExp 每日可获经验
 */
export function estimateDaysToLevel(currentLevel: number, dailyExp: number): number {
  if (dailyExp <= 0) return Infinity;
  
  const targetLevel = Math.min(currentLevel + 1, 200);
  const expNeeded = calcExpToLevel(currentLevel, targetLevel);
  
  return Math.ceil(expNeeded / dailyExp);
}

/**
 * 格式化经验数字
 */
export function formatExp(exp: number): string {
  if (exp >= 100000000) {
    return (exp / 100000000).toFixed(1) + '亿';
  }
  if (exp >= 10000) {
    return (exp / 10000).toFixed(1) + '万';
  }
  return exp.toLocaleString();
}

/**
 * 获取等级阶段颜色
 */
export function getTierColor(tier: keyof typeof LEVEL_TIERS): string {
  const colors: Record<keyof typeof LEVEL_TIERS, string> = {
    beginner: '#52c41a',
    growth: '#1890ff',
    mid: '#722ed1',
    late: '#fa8c16',
    end: '#f5222d',
    apex: '#eb2f96',
  };
  return colors[tier];
}

// 初始化等级经验表
generateLevelExpTable();

/**
 * 经验曲线统计
 */
export const EXP_CURVE_STATS = {
  /** 总升级经验（1-200级） */
  totalExpToMax: PLAYER_LEVELS[199]?.cumulativeExp || 0,
  
  /** 各阶段升级经验占比 */
  tierExpRatio: (() => {
    const tiers: Record<string, { levels: number; totalExp: number; ratio: number }> = {};
    const total = PLAYER_LEVELS[199]?.cumulativeExp || 1;
    
    for (const key of Object.keys(LEVEL_TIERS) as (keyof typeof LEVEL_TIERS)[]) {
      const config = LEVEL_TIERS[key];
      let tierExp = 0;
      
      for (let lv = config.minLevel; lv <= config.maxLevel; lv++) {
        const data = getLevelData(lv);
        if (data) tierExp += data.expToNext;
      }
      
      tiers[key] = {
        levels: config.maxLevel - config.minLevel + 1,
        totalExp: tierExp,
        ratio: tierExp / total,
      };
    }
    
    return tiers;
  })(),
};
