'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Card, InputNumber, Table, Tag, Button, Slider, Tabs, message, Statistic, Row, Col, Breadcrumb } from 'antd';
import {
  ExperimentOutlined,
  DollarOutlined,
  RiseOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  UserOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { calculateDailyRankReward, calculateChallengeReward } from '../data/arena';
import { STAMINA_CONFIG, calculateLevelReward, parseLevelCost } from '../data/levels';
import { getPrestigeLevelByLevel, calculateDailyPrestigeGain } from '../data/prestige';
import styles from './Calculator.module.css';

/** 综合计算器页面 */
export default function CalculatorPage() {
  // 基础配置
  const [playerLevel, setPlayerLevel] = useState<number>(100);
  const [prestigeLevel, setPrestigeLevel] = useState<number>(10);
  const [arenaRank, setArenaRank] = useState<number>(100);
  
  // 挑战配置
  const [arenaChallenges, setArenaChallenges] = useState<number>(10);
  const [arenaWinRate, setArenaWinRate] = useState<number>(50);
  const [levelChallenges, setLevelChallenges] = useState<number>(5);
  
  // 模拟天数
  const [simDays, setSimDays] = useState<number>(30);
  
  // 计算竞技场每日收益
  const arenaDailyReward = useMemo(() => {
    return calculateDailyRankReward(arenaRank, playerLevel);
  }, [arenaRank, playerLevel]);
  
  // 计算竞技场挑战收益
  const arenaChallengeReward = useMemo(() => {
    const winSilver = calculateChallengeReward(true, playerLevel, playerLevel, arenaRank).silver;
    const loseSilver = calculateChallengeReward(false, playerLevel, playerLevel, arenaRank).silver;
    const avgSilver = winSilver * (arenaWinRate / 100) + loseSilver * (1 - arenaWinRate / 100);
    const avgPrestige = 200 * (arenaWinRate / 100) + 160 * (1 - arenaWinRate / 100);
    return { silver: avgSilver, prestige: avgPrestige };
  }, [playerLevel, arenaRank, arenaWinRate]);
  
  // 计算忍阶每日收益
  const prestigeDailyGain = useMemo(() => {
    return calculateDailyPrestigeGain(prestigeLevel, arenaChallenges, arenaWinRate / 100);
  }, [prestigeLevel, arenaChallenges, arenaWinRate]);
  
  // 计算关卡收益
  const levelReward = useMemo(() => {
    // 假设通关一个普通关卡的平均收益
    const baseReward = calculateLevelReward(
      { id: 100001, name: '普通关卡', type: '主线剧情', cost: '体力：30点', reward: '' },
      playerLevel
    );
    return {
      silver: baseReward.silver * levelChallenges,
      exp: baseReward.exp * levelChallenges,
    };
  }, [playerLevel, levelChallenges]);
  
  // 每日总收益
  const dailyTotal = useMemo(() => {
    const arenaSilver = arenaDailyReward.silver + arenaChallengeReward.silver * arenaChallenges;
    const arenaPrestige = arenaDailyReward.prestige + arenaChallengeReward.prestige * arenaChallenges;
    const prestigeGain = prestigeDailyGain;
    const levelSilver = levelReward.silver;
    const levelExp = levelReward.exp;
    
    return {
      silver: arenaSilver + levelSilver,
      exp: levelExp,
      prestige: prestigeGain,
      staminaCost: levelChallenges * 30,
    };
  }, [arenaDailyReward, arenaChallengeReward, arenaChallenges, prestigeDailyGain, levelReward, levelChallenges]);
  
  // 模拟期总收益
  const simTotal = useMemo(() => {
    return {
      silver: dailyTotal.silver * simDays,
      exp: dailyTotal.exp * simDays,
      prestige: dailyTotal.prestige * simDays,
      staminaCost: dailyTotal.staminaCost * simDays,
    };
  }, [dailyTotal, simDays]);
  
  // 收益表格数据
  const revenueTableData = useMemo(() => [
    {
      key: 'arena',
      source: '竞技场 / Arena',
      category: '排名奖励 / Rank',
      silver: arenaDailyReward.silver,
      exp: 0,
      prestige: arenaDailyReward.prestige,
    },
    {
      key: 'arena-challenge',
      source: '竞技场 / Arena',
      category: '挑战奖励 / Challenge',
      silver: arenaChallengeReward.silver * arenaChallenges,
      exp: 0,
      prestige: arenaChallengeReward.prestige * arenaChallenges,
    },
    {
      key: 'level',
      source: '关卡 / Levels',
      category: '通关收益 / Clear',
      silver: levelReward.silver,
      exp: levelReward.exp,
      prestige: 0,
    },
  ], [arenaDailyReward, arenaChallengeReward, arenaChallenges, levelReward]);
  
  // 表格列定义
  const columns: ColumnsType<typeof revenueTableData[0]> = [
    {
      title: '来源 / Source',
      dataIndex: 'source',
      key: 'source',
      width: 150,
    },
    {
      title: '类型 / Category',
      dataIndex: 'category',
      key: 'category',
      width: 150,
    },
    {
      title: '银币 / Silver',
      dataIndex: 'silver',
      key: 'silver',
      width: 150,
      align: 'right',
      render: (val) => <span style={{ color: '#fa8c16' }}>{val.toLocaleString()}</span>,
    },
    {
      title: '经验 / EXP',
      dataIndex: 'exp',
      key: 'exp',
      width: 120,
      align: 'right',
      render: (val) => <span style={{ color: '#1890ff' }}>{val.toLocaleString()}</span>,
    },
    {
      title: '声望 / Prestige',
      dataIndex: 'prestige',
      key: 'prestige',
      width: 120,
      align: 'right',
      render: (val) => <span style={{ color: '#eb2f96' }}>{val.toLocaleString()}</span>,
    },
  ];
  
  // 重置配置
  const handleReset = useCallback(() => {
    setPlayerLevel(100);
    setPrestigeLevel(10);
    setArenaRank(100);
    setArenaChallenges(10);
    setArenaWinRate(50);
    setLevelChallenges(5);
    setSimDays(30);
    message.success('已重置 / Reset complete');
  }, []);
  
  return (
    <div className={styles.container}>
      {/* 面包屑导航 */}
      <Breadcrumb
        className={styles.breadcrumb}
        items={[
          { title: <Link href="/economy-simulator"><HomeOutlined /> 经济模拟</Link> },
          { title: <span><ExperimentOutlined /> 综合计算器 / Calculator</span> },
        ]}
      />

      {/* 顶部导航 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>🔬</span>
          <div className={styles.headerTitle}>
            <h1>综合计算器 / Calculator</h1>
            <p>综合收益与成长路线规划</p>
          </div>
        </div>
        <Link href="/economy-simulator" className={styles.backButton}>
          返回 / Back
        </Link>
      </header>
      
      {/* 主内容 */}
      <main className={styles.mainContent}>
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
                <label>忍阶等级 / Prestige Level:</label>
                <InputNumber
                  min={1}
                  max={36}
                  value={prestigeLevel}
                  onChange={(v) => setPrestigeLevel(v ?? 1)}
                  style={{ width: '100%' }}
                />
              </div>
              
              <div className={styles.inputItem}>
                <label>竞技场排名 / Arena Rank:</label>
                <InputNumber
                  min={1}
                  max={5000}
                  value={arenaRank}
                  onChange={(v) => setArenaRank(v ?? 1)}
                  style={{ width: '100%' }}
                />
              </div>
            </Card>
            
            <Card className={styles.configCard} title="竞技场配置 / Arena Config">
              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>每日挑战 / Challenges</span>
                  <strong>{arenaChallenges}</strong>
                </div>
                <Slider
                  min={0}
                  max={20}
                  value={arenaChallenges}
                  onChange={setArenaChallenges}
                />
              </div>
              
              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>胜率 / Win Rate</span>
                  <strong>{arenaWinRate}%</strong>
                </div>
                <Slider
                  min={0}
                  max={100}
                  value={arenaWinRate}
                  onChange={(v) => setArenaWinRate(v)}
                />
              </div>
            </Card>
            
            <Card className={styles.configCard} title="关卡配置 / Level Config">
              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>每日通关 / Daily Clears</span>
                  <strong>{levelChallenges}</strong>
                </div>
                <Slider
                  min={0}
                  max={20}
                  value={levelChallenges}
                  onChange={setLevelChallenges}
                />
              </div>
            </Card>
            
            <Card className={styles.configCard} title="模拟配置 / Simulation">
              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>模拟天数 / Sim Days</span>
                  <strong>{simDays}天</strong>
                </div>
                <Slider
                  min={1}
                  max={90}
                  value={simDays}
                  onChange={setSimDays}
                  marks={{ 1: '1', 30: '30', 60: '60', 90: '90' }}
                />
              </div>
            </Card>
            
            <Button type="default" onClick={handleReset} block>
              重置 / Reset
            </Button>
          </div>
          
          {/* 右侧结果 */}
          <div className={styles.calcResults}>
            {/* 每日收益总览 */}
            <Card className={styles.summaryCard}>
              <div className={styles.summaryHeader}>
                <ExperimentOutlined />
                <span>每日总收益 / Daily Revenue</span>
              </div>
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic
                    title={<><DollarOutlined style={{ color: '#fa8c16' }} /> 银币 / Silver</>}
                    value={dailyTotal.silver}
                    valueStyle={{ color: '#fa8c16', fontSize: '24px' }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={<><ThunderboltOutlined style={{ color: '#1890ff' }} /> 经验 / EXP</>}
                    value={dailyTotal.exp}
                    valueStyle={{ color: '#1890ff', fontSize: '24px' }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={<><RiseOutlined style={{ color: '#eb2f96' }} /> 声望 / Prestige</>}
                    value={dailyTotal.prestige}
                    valueStyle={{ color: '#eb2f96', fontSize: '24px' }}
                  />
                </Col>
              </Row>
              <div className={styles.staminaNote}>
                体力消耗: {dailyTotal.staminaCost}/天
              </div>
            </Card>
            
            {/* 模拟期总收益 */}
            <Card className={styles.simCard}>
              <div className={styles.simHeader}>
                <span>{simDays}天总收益 / {simDays} Days Total</span>
              </div>
              <Row gutter={16}>
                <Col span={8}>
                  <div className={styles.simItem}>
                    <div className={styles.simValue}>{simTotal.silver.toLocaleString()}</div>
                    <div className={styles.simLabel}>银币 / Silver</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div className={styles.simItem}>
                    <div className={styles.simValue}>{simTotal.exp.toLocaleString()}</div>
                    <div className={styles.simLabel}>经验 / EXP</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div className={styles.simItem}>
                    <div className={styles.simValue} style={{ color: '#eb2f96' }}>{simTotal.prestige.toLocaleString()}</div>
                    <div className={styles.simLabel}>声望 / Prestige</div>
                  </div>
                </Col>
              </Row>
              <div className={styles.simNote}>
                总体力消耗: {simTotal.staminaCost.toLocaleString()}
              </div>
            </Card>
            
            {/* 收益明细 */}
            <Card className={styles.detailCard}>
              <div className={styles.detailHeader}>
                <TrophyOutlined />
                <span>收益明细 / Revenue Details</span>
              </div>
              <Table
                columns={columns}
                dataSource={revenueTableData}
                pagination={false}
                size="small"
                rowKey="key"
                summary={() => (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={2}>
                        <strong>合计 / Total</strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right">
                        <strong style={{ color: '#fa8c16' }}>
                          {dailyTotal.silver.toLocaleString()}
                        </strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <strong style={{ color: '#1890ff' }}>
                          {dailyTotal.exp.toLocaleString()}
                        </strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <strong style={{ color: '#eb2f96' }}>
                          {dailyTotal.prestige.toLocaleString()}
                        </strong>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
            </Card>
            
            {/* 成长预估 */}
            <Card className={styles.growthCard}>
              <div className={styles.growthHeader}>
                <UserOutlined />
                <span>成长预估 / Growth Estimate</span>
              </div>
              <div className={styles.growthContent}>
                <div className={styles.growthItem}>
                  <Tag color="purple">忍阶等级 / Prestige</Tag>
                  <span className={styles.growthValue}>{prestigeLevel}级</span>
                  <span className={styles.growthNote}>
                    每日+{dailyTotal.prestige > 0 ? dailyTotal.prestige : 0}声望
                  </span>
                </div>
                <div className={styles.growthItem}>
                  <Tag color="blue">等级预估 / Level</Tag>
                  <span className={styles.growthValue}>
                    {Math.min(200, Math.floor(playerLevel + simTotal.exp / 1000))}级
                  </span>
                  <span className={styles.growthNote}>
                    预计+{Math.floor(simTotal.exp / 1000)}级
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
