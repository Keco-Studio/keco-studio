'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Card, InputNumber, Table, Tag, Button, Slider, Tabs, Progress, message, Breadcrumb } from 'antd';
import {
  TrophyOutlined,
  ThunderboltOutlined,
  DollarOutlined,
  RiseOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  ARENA_RANK_DATA,
  getPrestigeRewardByRank,
  getSilverRewardByRank,
  calculateDailyRankReward,
  calculateChallengeReward,
  getRankTierName,
} from '../data/arena';
import { STAMINA_CONFIG } from '../data/levels';
import styles from './Arena.module.css';

/** 竞技场页面 */
export default function ArenaPage() {
  // 当前标签页
  const [activeTab, setActiveTab] = useState<string>('calculator');

  // 主将等级
  const [playerLevel, setPlayerLevel] = useState<number>(100);

  // 当前排名
  const [currentRank, setCurrentRank] = useState<number>(100);

  // 目标排名
  const [targetRank, setTargetRank] = useState<number>(50);

  // 每日挑战次数
  const [dailyChallenges, setDailyChallenges] = useState<number>(10);

  // 胜率
  const [winRate, setWinRate] = useState<number>(0.5);

  // 计算每日奖励
  const dailyReward = useMemo(() => {
    return calculateDailyRankReward(currentRank, playerLevel);
  }, [currentRank, playerLevel]);

  // 计算单次挑战平均奖励
  const challengeReward = useMemo(() => {
    const targetLevel = playerLevel; // 假设对手等级与自己相同
    const avgSilver = calculateChallengeReward(true, playerLevel, targetLevel, currentRank).silver * winRate +
      calculateChallengeReward(false, playerLevel, targetLevel, currentRank).silver * (1 - winRate);
    const avgPrestige = 200 * winRate + 160 * (1 - winRate); // 胜利200，失败160
    return { silver: avgSilver, prestige: avgPrestige };
  }, [playerLevel, currentRank, winRate]);

  // 计算每日总收益
  const totalDailyReward = useMemo(() => {
    const challengesSilver = challengeReward.silver * dailyChallenges;
    const challengesPrestige = challengeReward.prestige * dailyChallenges;
    return {
      silver: dailyReward.silver + challengesSilver,
      prestige: dailyReward.prestige + Math.floor(challengesPrestige),
    };
  }, [dailyReward, challengeReward, dailyChallenges]);

  // 晋级所需天数估算
  const daysToRankUp = useMemo(() => {
    if (targetRank >= currentRank) return Infinity;

    const rankDiff = currentRank - targetRank;
    const netPrestigePerDay = totalDailyReward.prestige;

    if (netPrestigePerDay <= 0) return Infinity;
    return Math.ceil(rankDiff * 100 / netPrestigePerDay);
  }, [currentRank, targetRank, totalDailyReward.prestige]);

  // 排名表格列
  const rankColumns: ColumnsType<{ rank: number; prestigeReward: number; silverReward: number; tier: string }> = [
    {
      title: '排名 / Rank',
      dataIndex: 'rank',
      key: 'rank',
      width: 100,
      align: 'center',
      render: (rank) => <strong>#{rank}</strong>,
    },
    {
      title: '段位 / Tier',
      dataIndex: 'tier',
      key: 'tier',
      width: 150,
      render: (tier) => <Tag color="gold">{tier}</Tag>,
    },
    {
      title: '声望奖励 / Prestige',
      dataIndex: 'prestigeReward',
      key: 'prestigeReward',
      width: 150,
      align: 'right',
      render: (val) => <span style={{ color: '#eb2f96' }}>{val.toLocaleString()}</span>,
    },
    {
      title: '银币奖励 / Silver',
      dataIndex: 'silverReward',
      key: 'silverReward',
      align: 'right',
      render: (val) => <span style={{ color: '#fa8c16' }}>{val.toLocaleString()}</span>,
    },
  ];

  // 排名表格数据
  const rankTableData = useMemo(() =>
    ARENA_RANK_DATA.slice(0, 50).map(data => ({
      ...data,
      tier: getRankTierName(data.rank),
    })),
    []
  );

  // 重置配置
  const handleReset = useCallback(() => {
    setPlayerLevel(100);
    setCurrentRank(100);
    setTargetRank(50);
    setDailyChallenges(10);
    setWinRate(0.5);
    message.success('已重置 / Reset complete');
  }, []);

  const tabItems = [
    {
      key: 'calculator',
      label: (
        <span>
          <ThunderboltOutlined /> 收益计算 / Calculator
        </span>
      ),
      children: (
        <div className={styles.calcContent}>
          {/* 左侧配置 */}
          <div className={styles.calcPanel}>
            <Card className={styles.configCard} title="基础配置 / Basic Config">
              <div className={styles.inputItem}>
                <label>主将等级 / Player Level:</label>
                <InputNumber
                  min={1}
                  max={200}
                  value={playerLevel}
                  onChange={(v) => setPlayerLevel(v ?? 1)}
                  style={{ width: '100%' }}
                />
              </div>

              <div className={styles.inputItem}>
                <label>当前排名 / Current Rank:</label>
                <InputNumber
                  min={1}
                  max={5000}
                  value={currentRank}
                  onChange={(v) => setCurrentRank(v ?? 1)}
                  style={{ width: '100%' }}
                />
              </div>

              <div className={styles.inputItem}>
                <label>目标排名 / Target Rank:</label>
                <InputNumber
                  min={1}
                  max={currentRank}
                  value={targetRank}
                  onChange={(v) => setTargetRank(v ?? 1)}
                  style={{ width: '100%' }}
                />
              </div>
            </Card>

            <Card className={styles.configCard} title="挑战配置 / Challenge Config">
              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>每日挑战次数 / Daily Challenges</span>
                  <strong>{dailyChallenges}</strong>
                </div>
                <Slider
                  min={0}
                  max={20}
                  value={dailyChallenges}
                  onChange={setDailyChallenges}
                  marks={{ 0: '0', 10: '10', 20: '20' }}
                />
              </div>

              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>胜率 / Win Rate</span>
                  <strong>{(winRate * 100).toFixed(0)}%</strong>
                </div>
                <Slider
                  min={0}
                  max={100}
                  value={winRate * 100}
                  onChange={(v) => setWinRate(v / 100)}
                  marks={{ 0: '0%', 50: '50%', 100: '100%' }}
                />
              </div>
            </Card>

            <Button type="default" onClick={handleReset} block>
              重置 / Reset
            </Button>
          </div>

          {/* 右侧结果 */}
          <div className={styles.calcResults}>
            {/* 排名奖励卡片 */}
            <Card className={styles.resultCard}>
              <div className={styles.rewardHeader}>
                <TrophyOutlined className={styles.rewardIcon} />
                <span>当前排名 # {currentRank}</span>
                <Tag color="gold">{getRankTierName(currentRank)}</Tag>
              </div>
              <div className={styles.rewardGrid}>
                <div className={styles.rewardItem}>
                  <DollarOutlined className={styles.silverIcon} />
                  <div className={styles.rewardContent}>
                    <div className={styles.rewardValue}>{dailyReward.silver.toLocaleString()}</div>
                    <div className={styles.rewardLabel}>每日银币 / Daily Silver</div>
                  </div>
                </div>
                <div className={styles.rewardItem}>
                  <RiseOutlined className={styles.prestigeIcon} />
                  <div className={styles.rewardContent}>
                    <div className={styles.rewardValue}>{dailyReward.prestige.toLocaleString()}</div>
                    <div className={styles.rewardLabel}>每日声望 / Daily Prestige</div>
                  </div>
                </div>
              </div>
            </Card>

            {/* 挑战收益卡片 */}
            <Card className={styles.resultCard}>
              <div className={styles.rewardHeader}>
                <ThunderboltOutlined className={styles.challengeIcon} />
                <span>单次挑战平均收益 / Per Challenge</span>
              </div>
              <div className={styles.rewardGrid}>
                <div className={styles.rewardItem}>
                  <DollarOutlined className={styles.silverIcon} />
                  <div className={styles.rewardContent}>
                    <div className={styles.rewardValue}>{challengeReward.silver.toLocaleString()}</div>
                    <div className={styles.rewardLabel}>银币 / Silver</div>
                  </div>
                </div>
                <div className={styles.rewardItem}>
                  <RiseOutlined className={styles.prestigeIcon} />
                  <div className={styles.rewardContent}>
                    <div className={styles.rewardValue}>{challengeReward.prestige.toFixed(0)}</div>
                    <div className={styles.rewardLabel}>声望 / Prestige</div>
                  </div>
                </div>
              </div>
            </Card>

            {/* 总收益卡片 */}
            <Card className={styles.summaryCard}>
              <div className={styles.summaryHeader}>
                <span>每日总收益 / Daily Total</span>
                <span className={styles.challengesNote}>({dailyChallenges}次挑战)</span>
              </div>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <div className={styles.summaryValue}>{totalDailyReward.silver.toLocaleString()}</div>
                  <div className={styles.summaryLabel}>银币 / Silver</div>
                </div>
                <div className={styles.summaryItem}>
                  <div className={styles.summaryValue}>{totalDailyReward.prestige.toLocaleString()}</div>
                  <div className={styles.summaryLabel}>声望 / Prestige</div>
                </div>
              </div>
            </Card>

            {/* 晋级预估卡片 */}
            <Card className={styles.rankUpCard}>
              <div className={styles.rankUpHeader}>
                <span>晋级预估 / Rank Up Estimate</span>
              </div>
              <div className={styles.rankUpContent}>
                <div className={styles.rankUpRange}>
                  <Tag color="blue"># {currentRank}</Tag>
                  <span>→</span>
                  <Tag color="green"># {targetRank}</Tag>
                </div>
                {daysToRankUp === Infinity ? (
                  <div className={styles.rankUpWarning}>
                    声望收益为负或无收益，无法晋级
                  </div>
                ) : daysToRankUp > 365 ? (
                  <div className={styles.rankUpWarning}>
                    预计需要 {Math.ceil(daysToRankUp / 30)} 个月以上
                  </div>
                ) : (
                  <div className={styles.rankUpDays}>
                    <span className={styles.daysNumber}>{daysToRankUp}</span>
                    <span className={styles.daysLabel}>天 / Days</span>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      ),
    },
    {
      key: 'rankings',
      label: (
        <span>
          <TrophyOutlined /> 排名奖励 / Rankings
        </span>
      ),
      children: (
        <Card className={styles.tableCard}>
          <Table
            columns={rankColumns}
            dataSource={rankTableData}
            pagination={{ pageSize: 10 }}
            size="small"
            rowKey="rank"
          />
        </Card>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>🏆</span>
          <div className={styles.headerTitle}>
            <h1>竞技场 / Arena</h1>
            <p>竞技场收益与排名计算</p>
          </div>
        </div>
        <Link href="/simulation-system/economy/overview" className={styles.backButton}>
          返回 / Back
        </Link>
      </header>

      {/* 主内容 */}
      <main className={styles.mainContent}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          style={{ width: '100%' }}
        />
      </main>
    </div>
  );
}
