/**
 * 竞技场数据 - Arena Data
 * 基于《火影忍者》竞技场数据
 */

import type { ArenaRankData, ArenaRewardConfig } from '../types';

/**
 * 竞技场排名数据（部分数据）
 * 完整的排名数据需要从5000+行CSV中解析
 */
export const ARENA_RANK_DATA: ArenaRankData[] = [
  // 排名 1-50 的数据（从CSV第1-50行）
  { rank: 1, prestigeReward: 20000, silverReward: 49726 },
  { rank: 2, prestigeReward: 16000, silverReward: 45940 },
  { rank: 3, prestigeReward: 14000, silverReward: 43726 },
  { rank: 4, prestigeReward: 13000, silverReward: 42155 },
  { rank: 5, prestigeReward: 12000, silverReward: 40936 },
  { rank: 6, prestigeReward: 11600, silverReward: 39940 },
  { rank: 7, prestigeReward: 11200, silverReward: 39098 },
  { rank: 8, prestigeReward: 10800, silverReward: 38369 },
  { rank: 9, prestigeReward: 10400, silverReward: 37726 },
  { rank: 10, prestigeReward: 10000, silverReward: 37150 },
  { rank: 11, prestigeReward: 9800, silverReward: 36630 },
  { rank: 12, prestigeReward: 9600, silverReward: 36155 },
  { rank: 13, prestigeReward: 9400, silverReward: 35717 },
  { rank: 14, prestigeReward: 9200, silverReward: 35313 },
  { rank: 15, prestigeReward: 9000, silverReward: 34936 },
  { rank: 16, prestigeReward: 8800, silverReward: 34583 },
  { rank: 17, prestigeReward: 8600, silverReward: 34252 },
  { rank: 18, prestigeReward: 8400, silverReward: 33940 },
  { rank: 19, prestigeReward: 8200, silverReward: 33645 },
  { rank: 20, prestigeReward: 8000, silverReward: 33365 },
  { rank: 21, prestigeReward: 7950, silverReward: 33098 },
  { rank: 22, prestigeReward: 7900, silverReward: 32844 },
  { rank: 23, prestigeReward: 7850, silverReward: 32601 },
  { rank: 24, prestigeReward: 7800, silverReward: 32369 },
  { rank: 25, prestigeReward: 7750, silverReward: 32146 },
  { rank: 26, prestigeReward: 7700, silverReward: 31932 },
  { rank: 27, prestigeReward: 7650, silverReward: 31726 },
  { rank: 28, prestigeReward: 7600, silverReward: 31527 },
  { rank: 29, prestigeReward: 7550, silverReward: 31335 },
  { rank: 30, prestigeReward: 7500, silverReward: 31150 },
  { rank: 31, prestigeReward: 7450, silverReward: 30971 },
  { rank: 32, prestigeReward: 7400, silverReward: 30798 },
  { rank: 33, prestigeReward: 7350, silverReward: 30630 },
  { rank: 34, prestigeReward: 7300, silverReward: 30467 },
  { rank: 35, prestigeReward: 7250, silverReward: 30308 },
  { rank: 36, prestigeReward: 7200, silverReward: 30155 },
  { rank: 37, prestigeReward: 7150, silverReward: 30005 },
  { rank: 38, prestigeReward: 7100, silverReward: 29859 },
  { rank: 39, prestigeReward: 7050, silverReward: 29717 },
  { rank: 40, prestigeReward: 7030, silverReward: 29579 },
  { rank: 41, prestigeReward: 7010, silverReward: 29444 },
  { rank: 42, prestigeReward: 6990, silverReward: 29313 },
  { rank: 43, prestigeReward: 6970, silverReward: 29184 },
  { rank: 44, prestigeReward: 6950, silverReward: 29059 },
  { rank: 45, prestigeReward: 6930, silverReward: 28936 },
  { rank: 46, prestigeReward: 6910, silverReward: 28816 },
  { rank: 47, prestigeReward: 6890, silverReward: 28698 },
  { rank: 48, prestigeReward: 6870, silverReward: 28583 },
  { rank: 49, prestigeReward: 6850, silverReward: 28471 },
  { rank: 50, prestigeReward: 6830, silverReward: 28359 },
];

/** 竞技场配置 */
export const ARENA_CONFIG: ArenaRewardConfig = {
  dailyPurchaseCount: 0,
  winRate: 0.5,
};

/**
 * 根据排名获取声望奖励
 */
export function getPrestigeRewardByRank(rank: number): number {
  const data = ARENA_RANK_DATA.find(d => d.rank === rank);
  if (data) return data.prestigeReward;
  
  // 超过50名后的插值计算
  if (rank > 50) {
    const baseData = ARENA_RANK_DATA[49]; // 第50名的数据
    // 线性插值衰减
    const decayRate = 0.995;
    return Math.floor(baseData.prestigeReward * Math.pow(decayRate, rank - 50));
  }
  
  return 0;
}

/**
 * 根据排名获取银币奖励
 */
export function getSilverRewardByRank(rank: number): number {
  const data = ARENA_RANK_DATA.find(d => d.rank === rank);
  if (data) return data.silverReward;
  
  // 超过50名后的插值计算
  if (rank > 50) {
    const baseData = ARENA_RANK_DATA[49];
    const decayRate = 0.998;
    return Math.floor(baseData.silverReward * Math.pow(decayRate, rank - 50));
  }
  
  return 0;
}

/**
 * 计算每日排名奖励
 * @param rank 竞技场排名
 * @param ownerLevel 主将等级
 */
export function calculateDailyRankReward(rank: number, ownerLevel: number): { silver: number; prestige: number } {
  // 每日排名奖励公式
  // int(2000 * pow(2, ownerLevel / 20.0) * log(6561.0 / (ArenaRank + 8)) / log(3.0));
  const levelFactor = Math.pow(2, ownerLevel / 20.0);
  const rankFactor = Math.log(6561.0 / (rank + 8)) / Math.log(3.0);
  const silver = Math.floor(2000 * levelFactor * rankFactor);
  
  // 声望奖励
  const prestige = getPrestigeRewardByRank(rank);
  
  return { silver, prestige };
}

/**
 * 计算单次挑战奖励
 * @param isWin 是否胜利
 * @param ownerLevel 主将等级
 * @param targetLevel 对方主将等级
 * @param targetArenaRank 挑战前对方排名
 */
export function calculateChallengeReward(
  isWin: boolean,
  ownerLevel: number,
  targetLevel: number,
  targetArenaRank: number
): { silver: number; prestige: number } {
  // 公式: int(150.0 * (0.6 + 0.4 * isWind) * power(2, (ownerLevel + targetLevel) / 40.0) * log(6561.0 / (targetArenaRank + 8)) /log(3.0));
  const winFactor = isWin ? 1.0 : 0.6;
  const levelFactor = Math.pow(2, (ownerLevel + targetLevel) / 40.0);
  const rankFactor = Math.log(6561.0 / (targetArenaRank + 8)) / Math.log(3.0);
  const silver = Math.floor(150.0 * winFactor * levelFactor * rankFactor);
  
  // 声望：胜利200，失败根据失败系数
  const prestige = isWin ? 200 : Math.floor(200 * 0.8);
  
  return { silver, prestige };
}

/**
 * 根据排名获取奖励分段名称
 */
export function getRankTierName(rank: number): string {
  if (rank <= 10) return '王者 / Champion';
  if (rank <= 50) return '大师 / Master';
  if (rank <= 100) return '钻石 / Diamond';
  if (rank <= 500) return '铂金 / Platinum';
  if (rank <= 1000) return '黄金 / Gold';
  return '白银 / Silver';
}

/**
 * 计算排名变化所需声望
 */
export function calculatePrestigeForRankUp(currentRank: number, targetRank: number): number {
  let totalPrestige = 0;
  for (let rank = currentRank; rank > targetRank; rank--) {
    totalPrestige += getPrestigeRewardByRank(rank);
  }
  return totalPrestige;
}
