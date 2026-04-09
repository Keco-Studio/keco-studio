'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Card, InputNumber, Button, Slider, message, Row, Col, Progress, Select, Tag } from 'antd';
import {
  ExperimentOutlined,
  DollarOutlined,
  RiseOutlined,
  ThunderboltOutlined,
  StarOutlined,
} from '@ant-design/icons';
import * as echarts from 'echarts';
import { calculateDailyPrestigeGain } from '../data/prestige';
import {
  getLevelData,
  getLevelByExp,
  calcLevelProgress,
  formatExp,
  getTierColor,
} from '../data/playerLevel';
import {
  LEVELS,
  calculateLevelReward,
  parseLevelCost,
} from '../data/levels';
import type { Level } from '../data/types';
import styles from './Calculator.module.css';

type EChartsInstance = echarts.ECharts;

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

  // 选中的关卡ID列表（用于计算日常收益）
  const [selectedLevelIds, setSelectedLevelIds] = useState<number[]>([100001, 100002, 100003, 100004, 100005]);

  // 模拟天数
  const [simDays, setSimDays] = useState<number>(30);

  // ECharts 实例引用
  const silverChartRef = useRef<HTMLDivElement>(null);
  const prestigeChartRef = useRef<HTMLDivElement>(null);
  const expChartRef = useRef<HTMLDivElement>(null);
  const dailyChartRef = useRef<HTMLDivElement>(null);
  const silverChartInstance = useRef<EChartsInstance | null>(null);
  const prestigeChartInstance = useRef<EChartsInstance | null>(null);
  const expChartInstance = useRef<EChartsInstance | null>(null);
  const dailyChartInstance = useRef<EChartsInstance | null>(null);

  // 获取当前等级数据
  const currentLevelData = useMemo(() => {
    return getLevelData(playerLevel);
  }, [playerLevel]);

  // 计算每日总收益（基于给定等级）
  const calculateDailyTotal = useCallback((level: number) => {
    const levelData = getLevelData(level);

    // ========== 银币收入计算 ==========
    // 设计目标：
    // - 100级：日收入 12,000-18,000（强化+50级需约7天）
    // - 200级：日收入 35,000-50,000（强化+50级需约10天）
    const silverCurve = (lv: number): number => {
      if (lv <= 50) {
        // 1-50级：对数增长
        return 2000 + 1500 * Math.log(lv + 1);
      } else if (lv <= 100) {
        // 51-100级：平方根增长
        return 6000 + 2500 * Math.sqrt(lv - 50) * 0.8;
      } else if (lv <= 150) {
        // 101-150级：平方根+线性混合
        return 10000 + 3500 * Math.sqrt(lv - 100) * 0.6 + 60 * (lv - 100);
      } else {
        // 151-200级：后期放缓
        return 18000 + 2500 * Math.sqrt(lv - 150) * 0.4 + 40 * (lv - 150);
      }
    };

    // 竞技场每日收益（基于排名的对数曲线）
    const baseArenaSilver = 3000;
    const arenaMultiplier = Math.log(50 / Math.min(arenaRank, 50)) / Math.log(50) * 2 + 0.8;
    const arenaDailyReward = Math.floor(baseArenaSilver * arenaMultiplier);

    // 竞技场挑战收益
    const challengeBase = 200;
    const challengeLevelFactor = 1 + Math.log(level + 1) * 0.35;
    const avgChallengeReward = challengeBase * challengeLevelFactor;
    const totalChallengeSilver = Math.floor(avgChallengeReward * arenaChallenges);

    // 关卡收益（从选中的关卡计算）
    const selectedLevels = selectedLevelIds
      .map(id => LEVELS.find(l => l.id === id))
      .filter(Boolean);
    let levelSilver = 0;
    let levelExp = 0;
    for (const lvl of selectedLevels) {
      if (lvl) {
        const reward = calculateLevelReward(lvl, level, false);
        levelSilver += reward.silver;
        levelExp += reward.exp;
      }
    }

    // ========== 经验收入计算 ==========
    const tierMultipliers: Record<string, number> = {
      beginner: 1.0,
      growth: 1.3,
      mid: 1.5,
      late: 1.8,
      end: 2.0,
      apex: 2.5,
    };
    const expMultiplier = tierMultipliers[levelData?.tier || 'beginner'];
    const totalExp = Math.floor(levelExp * expMultiplier);

    // ========== 声望收入 ==========
    const prestigeGain = calculateDailyPrestigeGain(prestigeLevel, arenaChallenges, arenaWinRate / 100);

    // 计算体力消耗
    const totalStamina = selectedLevels.reduce((sum, lvl) => {
      if (lvl) {
        const cost = parseLevelCost(lvl.cost);
        return sum + (cost?.type === 'stamina' ? cost.amount : 0);
      }
      return sum;
    }, 0);

    return {
      silver: arenaDailyReward + totalChallengeSilver + levelSilver,
      exp: totalExp,
      prestige: prestigeGain,
      staminaCost: totalStamina,
    };
  }, [arenaRank, arenaChallenges, arenaWinRate, prestigeLevel, selectedLevelIds]);

  // 每日总收益（初始等级，用于显示）
  const dailyTotal = useMemo(() => {
    return calculateDailyTotal(playerLevel);
  }, [calculateDailyTotal, playerLevel]);

  // 逐天动态模拟（等级会随经验提升）
  const simulationData = useMemo(() => {
    const days = [];
    const silverData = [];
    const prestigeData = [];
    const expData = [];
    const levelData = [];
    const dailyExpData = [];
    const dailySilverData = [];

    let cumulativeSilver = 0;
    let cumulativePrestige = 0;
    let cumulativeExp = 0;
    const initialCumulativeExp = currentLevelData?.cumulativeExp || 0;

    for (let i = 1; i <= simDays; i++) {
      days.push(`第${i}天`);

      // 根据当前累计经验计算当天等级
      const currentDayLevel = getLevelByExp(initialCumulativeExp + cumulativeExp);

      // 根据当天等级动态计算当日收益
      const dayTotal = calculateDailyTotal(currentDayLevel);

      cumulativeSilver += dayTotal.silver;
      cumulativePrestige += dayTotal.prestige;
      cumulativeExp += dayTotal.exp;

      silverData.push(cumulativeSilver);
      prestigeData.push(cumulativePrestige);
      expData.push(cumulativeExp);
      levelData.push(currentDayLevel);
      dailyExpData.push(dayTotal.exp);
      dailySilverData.push(dayTotal.silver);
    }

    return {
      days,
      silverData,
      prestigeData,
      expData,
      levelData,
      dailyExpData,
      dailySilverData,
    };
  }, [simDays, currentLevelData, calculateDailyTotal]);

  // 模拟期结束时的等级预测
  const levelPrediction = useMemo(() => {
    const finalLevel = simulationData.levelData[simulationData.levelData.length - 1] || playerLevel;
    const totalExp = simulationData.expData[simulationData.expData.length - 1] || 0;
    const progress = calcLevelProgress(
      finalLevel,
      (currentLevelData?.cumulativeExp || 0) + totalExp
    );
    return {
      targetLevel: finalLevel,
      progress: progress.progress,
      totalExp,
      levelsGained: finalLevel - playerLevel,
    };
  }, [simulationData, playerLevel, currentLevelData]);

  // 初始化 ECharts
  useEffect(() => {
    const initChart = (ref: React.RefObject<HTMLDivElement | null>, instance: React.MutableRefObject<EChartsInstance | null>, title: string, data: number[], color: string, formatter?: (val: number) => string) => {
      if (!ref.current) return;

      if (instance.current) {
        instance.current.dispose();
      }

      const chart = echarts.init(ref.current);
      instance.current = chart;

      const option: echarts.EChartsOption = {
        title: {
          text: title,
          left: 'center',
          textStyle: {
            fontSize: 14,
            fontWeight: 500,
            color: '#595959',
          },
        },
        tooltip: {
          trigger: 'axis',
          formatter: (params: any) => {
            const day = params[0].name;
            const value = params[0].value;
            return `${day}<br/>${formatter ? formatter(value) : value.toLocaleString()}`;
          },
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          top: '15%',
          containLabel: true,
        },
        xAxis: {
          type: 'category',
          data: simulationData.days,
          axisLabel: {
            interval: Math.floor(simDays / 5) - 1,
            rotate: 0,
            fontSize: 10,
          },
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            fontSize: 10,
            formatter: (val: number) => {
              if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
              if (val >= 1000) return (val / 1000).toFixed(0) + 'K';
              return val.toString();
            },
          },
        },
        series: [
          {
            name: title,
            type: 'line',
            smooth: true,
            data: data,
            lineStyle: {
              color: color,
              width: 3,
            },
            itemStyle: {
              color: color,
            },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: color + '80' },
                { offset: 1, color: color + '10' },
              ]),
            },
            symbol: 'circle',
            symbolSize: 4,
          },
        ],
      };

      chart.setOption(option);
    };

    initChart(silverChartRef, silverChartInstance, '银币累积收益', simulationData.silverData, '#fa8c16', (val) => `银币: ${val.toLocaleString()}`);
    initChart(prestigeChartRef, prestigeChartInstance, '声望累积收益', simulationData.prestigeData, '#eb2f96', (val) => `声望: ${val.toLocaleString()}`);
    initChart(expChartRef, expChartInstance, '经验累积收益', simulationData.expData, '#1890ff', (val) => `经验: ${formatExp(val)}`);

    // 等级曲线图
    if (expChartRef.current && expChartInstance.current) {
      expChartInstance.current.dispose();
    }
    const levelChart = echarts.init(expChartRef.current);
    expChartInstance.current = levelChart;
    levelChart.setOption({
      title: {
        text: '等级成长曲线',
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 500, color: '#595959' },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const day = params[0].name;
          const level = params[0].value;
          return `${day}<br/>等级: ${level}`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true },
      xAxis: {
        type: 'category',
        data: simulationData.days,
        axisLabel: { interval: Math.floor(simDays / 5) - 1, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        min: playerLevel,
        axisLabel: { fontSize: 10 },
      },
      series: [{
        name: '等级',
        type: 'line',
        smooth: true,
        data: simulationData.levelData,
        lineStyle: { color: '#52c41a', width: 3 },
        itemStyle: { color: '#52c41a' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#52c41a80' },
            { offset: 1, color: '#52c41a10' },
          ]),
        },
        symbol: 'circle',
        symbolSize: 4,
      }],
    });

    // 每日收益变化图（银币+经验）
    if (dailyChartRef.current && dailyChartInstance.current) {
      dailyChartInstance.current.dispose();
    }
    const dailyChart = echarts.init(dailyChartRef.current);
    dailyChartInstance.current = dailyChart;
    dailyChart.setOption({
      title: {
        text: '每日收益与等级变化',
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 500, color: '#595959' },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const day = params[0].name;
          let result = `${day}<br/>`;
          for (const param of params) {
            if (param.seriesName === '等级') {
              result += `等级: ${param.value}<br/>`;
            } else {
              result += `${param.marker} ${param.seriesName}: ${param.value.toLocaleString()}<br/>`;
            }
          }
          return result;
        },
      },
      legend: {
        data: ['等级', '每日银币', '每日经验'],
        top: '15%',
        textStyle: { fontSize: 10 },
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '25%', containLabel: true },
      xAxis: {
        type: 'category',
        data: simulationData.days,
        axisLabel: { interval: Math.floor(simDays / 5) - 1, fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          name: '收益',
          axisLabel: { fontSize: 10, formatter: (val: number) => val >= 1000 ? (val / 1000).toFixed(0) + 'K' : val },
        },
        {
          type: 'value',
          name: '等级',
          min: playerLevel,
          max: Math.max(playerLevel + 20, ...simulationData.levelData) + 5,
          axisLabel: { fontSize: 10 },
        },
      ],
      series: [
        {
          name: '每日银币',
          type: 'line',
          yAxisIndex: 0,
          data: simulationData.dailySilverData,
          lineStyle: { color: '#fa8c16', width: 2 },
          itemStyle: { color: '#fa8c16' },
          symbol: 'circle',
          symbolSize: 3,
        },
        {
          name: '每日经验',
          type: 'line',
          yAxisIndex: 0,
          data: simulationData.dailyExpData,
          lineStyle: { color: '#1890ff', width: 2 },
          itemStyle: { color: '#1890ff' },
          symbol: 'circle',
          symbolSize: 3,
        },
        {
          name: '等级',
          type: 'line',
          yAxisIndex: 1,
          data: simulationData.levelData,
          lineStyle: { color: '#52c41a', width: 3 },
          itemStyle: { color: '#52c41a' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#52c41a40' },
              { offset: 1, color: '#52c41a05' },
            ]),
          },
          symbol: 'circle',
          symbolSize: 4,
        },
      ],
    });

    return () => {
      silverChartInstance.current?.dispose();
      prestigeChartInstance.current?.dispose();
      expChartInstance.current?.dispose();
      dailyChartInstance.current?.dispose();
    };
  }, [simulationData, simDays, playerLevel]);

  // 重置配置
  const handleReset = useCallback(() => {
    setPlayerLevel(100);
    setPrestigeLevel(10);
    setArenaRank(100);
    setArenaChallenges(10);
    setArenaWinRate(50);
    setLevelChallenges(5);
    setSimDays(30);
    message.success('已重置');
  }, []);

  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>🔬</span>
          <div className={styles.headerTitle}>
            <h1>综合计算器</h1>
            <p>综合收益与成长路线规划</p>
          </div>
        </div>
        <Link href="/simulation-system/economy/characters" className={styles.backButton}>
          返回
        </Link>
      </header>

      {/* 主内容 */}
      <main className={styles.mainContent}>
        <div className={styles.calcContent}>
          {/* 左侧配置 */}
          <div className={styles.calcPanel}>
            <Card className={styles.configCard} title="基础配置">
              <div className={styles.inputItem}>
                <label>主将等级</label>
                <InputNumber
                  min={1}
                  max={200}
                  value={playerLevel}
                  onChange={(v) => setPlayerLevel(v ?? 1)}
                  style={{ width: '100%' }}
                />
              </div>

              <div className={styles.inputItem}>
                <label>忍阶等级</label>
                <InputNumber
                  min={1}
                  max={36}
                  value={prestigeLevel}
                  onChange={(v) => setPrestigeLevel(v ?? 1)}
                  style={{ width: '100%' }}
                />
              </div>

              <div className={styles.inputItem}>
                <label>竞技场排名</label>
                <InputNumber
                  min={1}
                  max={5000}
                  value={arenaRank}
                  onChange={(v) => setArenaRank(v ?? 1)}
                  style={{ width: '100%' }}
                />
              </div>
            </Card>

            <Card className={styles.configCard} title="竞技场配置">
              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>每日挑战</span>
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
                  <span>胜率</span>
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

            <Card className={styles.configCard} title="关卡配置">
              <div className={styles.inputItem}>
                <label>选择关卡</label>
                <Select
                  mode="multiple"
                  style={{ width: '100%' }}
                  value={selectedLevelIds}
                  onChange={setSelectedLevelIds}
                  options={LEVELS.map(l => ({
                    value: l.id,
                    label: (
                      <span>
                        <Tag color={l.type === '主线剧情' ? '#1890ff' : l.type === '征战副本' ? '#fa8c16' : '#52c41a'} style={{ fontSize: 10 }}>
                          {l.type.split('·')[0]}
                        </Tag>
                        {l.name} ({parseLevelCost(l.cost)?.type === 'stamina' ? `${parseLevelCost(l.cost)?.amount}体力` : '免费'})
                      </span>
                    ),
                  }))}
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label as unknown as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                  placeholder="选择日常关卡..."
                />
              </div>
              <div className={styles.levelInfo}>
                <span>已选 {selectedLevelIds.length} 关</span>
                <span>总体力: {selectedLevelIds.reduce((sum, id) => {
                  const lvl = LEVELS.find(l => l.id === id);
                  const cost = lvl ? parseLevelCost(lvl.cost) : null;
                  return sum + (cost?.type === 'stamina' ? cost.amount : 0);
                }, 0)}</span>
              </div>
            </Card>

            <Card className={styles.configCard} title="模拟配置">
              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>模拟天数</span>
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
              重置
            </Button>
          </div>

          {/* 右侧结果 */}
          <div className={styles.calcResults}>
            {/* 每日收益总览 */}
            <Card className={styles.summaryCard}>
              <div className={styles.summaryHeader}>
                <ExperimentOutlined />
                <span>每日总收益</span>
              </div>
              <Row gutter={16}>
                <Col span={8}>
                  <div className={styles.statItem}>
                    <div className={styles.statValue} style={{ color: '#fa8c16' }}>
                      {dailyTotal.silver.toLocaleString()}
                    </div>
                    <div className={styles.statLabel}>
                      <DollarOutlined style={{ color: '#fa8c16' }} /> 银币
                    </div>
                  </div>
                </Col>
                <Col span={8}>
                  <div className={styles.statItem}>
                    <div className={styles.statValue} style={{ color: '#1890ff' }}>
                      {formatExp(dailyTotal.exp)}
                    </div>
                    <div className={styles.statLabel}>
                      <ThunderboltOutlined style={{ color: '#1890ff' }} /> 经验
                    </div>
                  </div>
                </Col>
                <Col span={8}>
                  <div className={styles.statItem}>
                    <div className={styles.statValue} style={{ color: '#eb2f96' }}>
                      {dailyTotal.prestige.toLocaleString()}
                    </div>
                    <div className={styles.statLabel}>
                      <RiseOutlined style={{ color: '#eb2f96' }} /> 声望
                    </div>
                  </div>
                </Col>
              </Row>
              <div className={styles.staminaNote}>
                体力消耗: {dailyTotal.staminaCost}/天 | 阶段倍率: {currentLevelData?.tier === 'beginner' ? '1.0x' : currentLevelData?.tier === 'growth' ? '1.3x' : currentLevelData?.tier === 'mid' ? '1.8x' : currentLevelData?.tier === 'late' ? '2.5x' : currentLevelData?.tier === 'end' ? '3.5x' : '5.0x'}
              </div>
            </Card>

            {/* 等级进度卡片 */}
            <Card className={styles.summaryCard} style={{ background: `linear-gradient(135deg, ${getTierColor(currentLevelData?.tier || 'beginner')}15, ${getTierColor(currentLevelData?.tier || 'beginner')}05)` }}>
              <div className={styles.summaryHeader}>
                <StarOutlined style={{ color: getTierColor(currentLevelData?.tier || 'beginner') }} />
                <span>等级进度 ({currentLevelData?.tier === 'beginner' ? '新手期' : currentLevelData?.tier === 'growth' ? '成长期' : currentLevelData?.tier === 'mid' ? '中期' : currentLevelData?.tier === 'late' ? '后期' : currentLevelData?.tier === 'end' ? '终期' : '巅峰'})</span>
              </div>
              <Row gutter={16}>
                <Col span={8}>
                  <div className={styles.statItem}>
                    <div className={styles.statValue} style={{ color: getTierColor(currentLevelData?.tier || 'beginner') }}>
                      Lv.{playerLevel}
                    </div>
                    <div className={styles.statLabel}>当前等级</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div className={styles.statItem}>
                    <div className={styles.statValue} style={{ color: '#52c41a' }}>
                      Lv.{levelPrediction.targetLevel}
                    </div>
                    <div className={styles.statLabel}>{simDays}天后</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div className={styles.statItem}>
                    <div className={styles.statValue} style={{ color: '#1890ff' }}>
                      +{levelPrediction.targetLevel - playerLevel}
                    </div>
                    <div className={styles.statLabel}>升级</div>
                  </div>
                </Col>
              </Row>
              <Progress
                percent={Math.min(100, levelPrediction.progress * 100)}
                strokeColor={getTierColor(currentLevelData?.tier || 'beginner')}
                showInfo={false}
                style={{ marginTop: 12 }}
              />
              <div className={styles.staminaNote}>
                累计经验: {formatExp(levelPrediction.totalExp)} | 下一级所需: {formatExp(currentLevelData?.expToNext || 0)}
              </div>
            </Card>

            {/* 收益可视化 */}
            <Card className={styles.chartCard}>
              <div className={styles.chartHeader}>
                <ExperimentOutlined />
                <span>{simDays}天累积收益曲线</span>
              </div>
              <div className={styles.chartsGrid4}>
                <div className={styles.chartItem}>
                  <div ref={silverChartRef} className={styles.chart} />
                </div>
                <div className={styles.chartItem}>
                  <div ref={prestigeChartRef} className={styles.chart} />
                </div>
                <div className={styles.chartItem}>
                  <div ref={expChartRef} className={styles.chart} />
                </div>
                <div className={styles.chartItem}>
                  <div ref={dailyChartRef} className={styles.chart} />
                </div>
              </div>
            </Card>

            {/* 模拟期总收益 */}
            <Card className={styles.simCard}>
              <div className={styles.simHeader}>
                <span>{simDays}天总收益（动态计算）</span>
              </div>
              <Row gutter={16}>
                <Col span={8}>
                  <div className={styles.simItem}>
                    <div className={styles.simValue} style={{ color: '#fa8c16' }}>
                      {simulationData.silverData[simulationData.silverData.length - 1]?.toLocaleString() || '0'}
                    </div>
                    <div className={styles.simLabel}>银币</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div className={styles.simItem}>
                    <div className={styles.simValue} style={{ color: '#1890ff' }}>
                      {formatExp(simulationData.expData[simulationData.expData.length - 1] || 0)}
                    </div>
                    <div className={styles.simLabel}>经验</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div className={styles.simItem}>
                    <div className={styles.simValue} style={{ color: '#eb2f96' }}>
                      {simulationData.prestigeData[simulationData.prestigeData.length - 1]?.toLocaleString() || '0'}
                    </div>
                    <div className={styles.simLabel}>声望</div>
                  </div>
                </Col>
              </Row>
              <div className={styles.simNote}>
                等级提升: {playerLevel} → {levelPrediction.targetLevel} (+{levelPrediction.levelsGained})
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
