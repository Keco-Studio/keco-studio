/**
 * 忍阶声望数据 - Prestige Data
 * 基于《火影忍者》忍阶数据
 */

import type { PrestigeLevel } from '../types';

/** 忍阶列表（1-36级完整数据） */
export const PRESTIGE_LEVELS: PrestigeLevel[] = [
  { level: 1, name: '忍者学员', requiredPrestige: 0, dailyCost: 0, silverReward: 40000, ultimateReward: 100, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 2, name: '下忍·牙', requiredPrestige: 2000, dailyCost: 0, silverReward: 46068, ultimateReward: 100, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 3, name: '下忍·兽', requiredPrestige: 1200, dailyCost: 0, silverReward: 52632, ultimateReward: 150, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 4, name: '下忍·灵', requiredPrestige: 1600, dailyCost: 0, silverReward: 59722, ultimateReward: 200, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 5, name: '下忍·藏', requiredPrestige: 2000, dailyCost: 0, silverReward: 67368, ultimateReward: 250, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 6, name: '下忍·魔', requiredPrestige: 2400, dailyCost: 0, silverReward: 75570, ultimateReward: 300, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 7, name: '中忍·牙', requiredPrestige: 2800, dailyCost: 0, silverReward: 84448, ultimateReward: 1000, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 8, name: '中忍·兽', requiredPrestige: 4000, dailyCost: 0, silverReward: 93942, ultimateReward: 1050, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 9, name: '中忍·灵', requiredPrestige: 7000, dailyCost: 0, silverReward: 104184, ultimateReward: 1100, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 10, name: '中忍·藏', requiredPrestige: 10000, dailyCost: 0, silverReward: 115178, ultimateReward: 1150, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 11, name: '中忍·魔', requiredPrestige: 13000, dailyCost: 0, silverReward: 126960, ultimateReward: 1200, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 12, name: '上忍·牙', requiredPrestige: 16000, dailyCost: 0, silverReward: 139608, ultimateReward: 1250, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 13, name: '上忍·兽', requiredPrestige: 20000, dailyCost: 0, silverReward: 153208, ultimateReward: 1300, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 14, name: '上忍·灵', requiredPrestige: 28000, dailyCost: 0, silverReward: 167716, ultimateReward: 1350, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 15, name: '上忍·藏', requiredPrestige: 30000, dailyCost: 0, silverReward: 183312, ultimateReward: 1400, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 16, name: '上忍·魔', requiredPrestige: 30000, dailyCost: 0, silverReward: 200000, ultimateReward: 1450, winPrestige: 200, loseCoefficient: 0.8, dailyGain: 7695 },
  { level: 17, name: '暗部·牙', requiredPrestige: 40000, dailyCost: 0, silverReward: 217828, ultimateReward: 1500, winPrestige: 200, loseCoefficient: 0.7, dailyGain: 7545 },
  { level: 18, name: '暗部·兽', requiredPrestige: 60000, dailyCost: 0, silverReward: 236898, ultimateReward: 1550, winPrestige: 200, loseCoefficient: 0.7, dailyGain: 7545 },
  { level: 19, name: '暗部·灵', requiredPrestige: 70000, dailyCost: 0, silverReward: 257264, ultimateReward: 1600, winPrestige: 200, loseCoefficient: 0.7, dailyGain: 7545 },
  { level: 20, name: '暗部·藏', requiredPrestige: 80000, dailyCost: 0, silverReward: 279096, ultimateReward: 1650, winPrestige: 200, loseCoefficient: 0.7, dailyGain: 7545 },
  { level: 21, name: '暗部·魔', requiredPrestige: 90000, dailyCost: 0, silverReward: 302340, ultimateReward: 1700, winPrestige: 200, loseCoefficient: 0.7, dailyGain: 7545 },
  { level: 22, name: '影·牙', requiredPrestige: 100000, dailyCost: 6000, silverReward: 327236, ultimateReward: 1750, winPrestige: 200, loseCoefficient: 0.7, dailyGain: 1545 },
  { level: 23, name: '影·兽', requiredPrestige: 120000, dailyCost: 6000, silverReward: 353728, ultimateReward: 1800, winPrestige: 200, loseCoefficient: 0.7, dailyGain: 1545 },
  { level: 24, name: '影·灵', requiredPrestige: 140000, dailyCost: 6000, silverReward: 382074, ultimateReward: 1850, winPrestige: 200, loseCoefficient: 0.7, dailyGain: 1545 },
  { level: 25, name: '影·藏', requiredPrestige: 230000, dailyCost: 6000, silverReward: 412216, ultimateReward: 1900, winPrestige: 200, loseCoefficient: 0.7, dailyGain: 1545 },
  { level: 26, name: '影·魔', requiredPrestige: 200000, dailyCost: 6000, silverReward: 444430, ultimateReward: 1950, winPrestige: 200, loseCoefficient: 0.7, dailyGain: 1545 },
  { level: 27, name: '木下之影', requiredPrestige: 200000, dailyCost: 8000, silverReward: 478728, ultimateReward: 2000, winPrestige: 200, loseCoefficient: 0.6, dailyGain: -605 },
  { level: 28, name: '苍蓝野兽', requiredPrestige: 300000, dailyCost: 8000, silverReward: 515336, ultimateReward: 2050, winPrestige: 200, loseCoefficient: 0.6, dailyGain: -605 },
  { level: 29, name: '木遁传藏', requiredPrestige: 300000, dailyCost: 8000, silverReward: 554268, ultimateReward: 2100, winPrestige: 200, loseCoefficient: 0.6, dailyGain: -605 },
  { level: 30, name: '木叶白牙', requiredPrestige: 400000, dailyCost: 10000, silverReward: 595764, ultimateReward: 2150, winPrestige: 200, loseCoefficient: 0.6, dailyGain: -2605 },
  { level: 31, name: '蛤蟆仙人', requiredPrestige: 400000, dailyCost: 10000, silverReward: 640000, ultimateReward: 2200, winPrestige: 200, loseCoefficient: 0.6, dailyGain: -2605 },
  { level: 32, name: '空之太刀', requiredPrestige: 400000, dailyCost: 12000, silverReward: 686996, ultimateReward: 2250, winPrestige: 200, loseCoefficient: 0.5, dailyGain: -4755 },
  { level: 33, name: '亲热天堂', requiredPrestige: 500000, dailyCost: 16000, silverReward: 737016, ultimateReward: 2300, winPrestige: 200, loseCoefficient: 0.5, dailyGain: -8755 },
  { level: 34, name: '金色闪光', requiredPrestige: 500000, dailyCost: 20000, silverReward: 790254, ultimateReward: 2350, winPrestige: 200, loseCoefficient: 0.5, dailyGain: -12755 },
  { level: 35, name: '森之千手', requiredPrestige: 600000, dailyCost: 25000, silverReward: 846912, ultimateReward: 2400, winPrestige: 200, loseCoefficient: 0.5, dailyGain: -17755 },
  { level: 36, name: '六道', requiredPrestige: 600000, dailyCost: 30000, silverReward: 1154880, ultimateReward: 2500, winPrestige: 200, loseCoefficient: 0.5, dailyGain: -22755 },
];

/** 忍阶等级分组 */
export const PRESTIGE_TIERS = {
  /** 学员级 (1-6) */
  trainee: { minLevel: 1, maxLevel: 6, label: '学员 / Trainee', color: '#8c8c8c' },
  /** 中忍级 (7-11) */
  chunin: { minLevel: 7, maxLevel: 11, label: '中忍 / Chunin', color: '#52c41a' },
  /** 上忍级 (12-16) */
  jonin: { minLevel: 12, maxLevel: 16, label: '上忍 / Jonin', color: '#1890ff' },
  /** 暗部级 (17-21) */
  anbu: { minLevel: 17, maxLevel: 21, label: '暗部 / Anbu', color: '#722ed1' },
  /** 影级 (22-26) */
  kage: { minLevel: 22, maxLevel: 26, label: '影 / Kage', color: '#fa8c16' },
  /** 传说级 (27-36) */
  legend: { minLevel: 27, maxLevel: 36, label: '传说 / Legend', color: '#eb2f96' },
};

/**
 * 根据等级获取忍阶数据
 */
export function getPrestigeLevelByLevel(level: number): PrestigeLevel | undefined {
  return PRESTIGE_LEVELS.find(p => p.level === level);
}

/**
 * 获取当前忍阶信息
 */
export function getCurrentPrestigeInfo(currentPrestige: number): {
  currentLevel: number;
  currentName: string;
  nextLevel: number;
  nextName: string;
  progress: number;
  requiredPrestige: number;
} {
  let currentLevel = 1;
  let currentName = PRESTIGE_LEVELS[0].name;
  
  // 找到当前所在的忍阶
  for (let i = PRESTIGE_LEVELS.length - 1; i >= 0; i--) {
    if (currentPrestige >= PRESTIGE_LEVELS[i].requiredPrestige) {
      currentLevel = PRESTIGE_LEVELS[i].level;
      currentName = PRESTIGE_LEVELS[i].name;
      break;
    }
  }
  
  // 找到下一个忍阶
  const currentIndex = PRESTIGE_LEVELS.findIndex(p => p.level === currentLevel);
  const nextLevel = currentIndex < PRESTIGE_LEVELS.length - 1 ? PRESTIGE_LEVELS[currentIndex + 1].level : currentLevel;
  const nextName = currentIndex < PRESTIGE_LEVELS.length - 1 ? PRESTIGE_LEVELS[currentIndex + 1].name : currentName;
  const requiredPrestige = currentIndex < PRESTIGE_LEVELS.length - 1 ? PRESTIGE_LEVELS[currentIndex + 1].requiredPrestige : 0;
  
  // 计算进度
  const currentRequired = PRESTIGE_LEVELS[currentIndex].requiredPrestige;
  const progress = requiredPrestige > 0
    ? Math.min(1, (currentPrestige - currentRequired) / (requiredPrestige - currentRequired))
    : 1;
  
  return {
    currentLevel,
    currentName,
    nextLevel,
    nextName,
    progress,
    requiredPrestige,
  };
}

/**
 * 计算晋升所需声望
 */
export function calculatePrestigeRequired(targetLevel: number): number {
  const targetData = getPrestigeLevelByLevel(targetLevel);
  return targetData?.requiredPrestige || 0;
}

/**
 * 计算每日净声望收益
 */
export function calculateDailyPrestigeGain(level: number, challenges: number, winRate: number): number {
  const prestigeData = getPrestigeLevelByLevel(level);
  if (!prestigeData) return 0;
  
  // 每日基础声望
  const baseDaily = prestigeData.dailyGain;
  
  // 竞技场声望（假设每次挑战胜利获得200声望）
  const arenaPrestige = challenges * winRate * prestigeData.winPrestige;
  
  return Math.floor(baseDaily + arenaPrestige);
}

/**
 * 获取忍阶等级分段
 */
export function getPrestigeTier(level: number): typeof PRESTIGE_TIERS[keyof typeof PRESTIGE_TIERS] | null {
  if (level >= PRESTIGE_TIERS.trainee.minLevel && level <= PRESTIGE_TIERS.trainee.maxLevel) {
    return PRESTIGE_TIERS.trainee;
  }
  if (level >= PRESTIGE_TIERS.chunin.minLevel && level <= PRESTIGE_TIERS.chunin.maxLevel) {
    return PRESTIGE_TIERS.chunin;
  }
  if (level >= PRESTIGE_TIERS.jonin.minLevel && level <= PRESTIGE_TIERS.jonin.maxLevel) {
    return PRESTIGE_TIERS.jonin;
  }
  if (level >= PRESTIGE_TIERS.anbu.minLevel && level <= PRESTIGE_TIERS.anbu.maxLevel) {
    return PRESTIGE_TIERS.anbu;
  }
  if (level >= PRESTIGE_TIERS.kage.minLevel && level <= PRESTIGE_TIERS.kage.maxLevel) {
    return PRESTIGE_TIERS.kage;
  }
  if (level >= PRESTIGE_TIERS.legend.minLevel && level <= PRESTIGE_TIERS.legend.maxLevel) {
    return PRESTIGE_TIERS.legend;
  }
  return null;
}
