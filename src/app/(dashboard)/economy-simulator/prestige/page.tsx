'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Card, Select, InputNumber, Table, Tag, Button, Slider, Tabs, Progress, message, Steps, Breadcrumb } from 'antd';
import {
  StarOutlined,
  ThunderboltOutlined,
  DollarOutlined,
  RiseOutlined,
  ArrowUpOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  PRESTIGE_LEVELS,
  PRESTIGE_TIERS,
  getPrestigeLevelByLevel,
  getCurrentPrestigeInfo,
  calculateDailyPrestigeGain,
  getPrestigeTier,
} from '../data/prestige';
import type { PrestigeLevel } from '../types';
import styles from './Prestige.module.css';

/** 忍阶声望页面 */
export default function PrestigePage() {
  // 当前标签页
  const [activeTab, setActiveTab] = useState<string>('calculator');
  
  // 当前声望值
  const [currentPrestige, setCurrentPrestige] = useState<number>(5000);
  
  // 目标忍阶等级
  const [targetLevel, setTargetLevel] = useState<number>(10);
  
  // 每日挑战次数
  const [dailyChallenges, setDailyChallenges] = useState<number>(10);
  
  // 胜率
  const [winRate, setWinRate] = useState<number>(0.5);
  
  // 获取当前忍阶信息
  const prestigeInfo = useMemo(() => {
    return getCurrentPrestigeInfo(currentPrestige);
  }, [currentPrestige]);
  
  // 每日净声望收益
  const dailyPrestigeGain = useMemo(() => {
    return calculateDailyPrestigeGain(prestigeInfo.currentLevel, dailyChallenges, winRate);
  }, [prestigeInfo.currentLevel, dailyChallenges, winRate]);
  
  // 晋升到目标等级所需天数
  const daysToTarget = useMemo(() => {
    const targetData = getPrestigeLevelByLevel(targetLevel);
    if (!targetData) return Infinity;
    
    const required = targetData.requiredPrestige;
    if (currentPrestige >= required) return 0;
    
    const diff = required - currentPrestige;
    if (dailyPrestigeGain <= 0) return Infinity;
    
    return Math.ceil(diff / dailyPrestigeGain);
  }, [currentPrestige, targetLevel, dailyPrestigeGain]);
  
  // 获取当前忍阶数据
  const currentLevelData = useMemo(() => {
    return getPrestigeLevelByLevel(prestigeInfo.currentLevel);
  }, [prestigeInfo.currentLevel]);
  
  // 忍阶表格列
  const prestigeColumns: ColumnsType<PrestigeLevel> = [
    {
      title: '忍阶 / Level',
      dataIndex: 'level',
      key: 'level',
      width: 80,
      align: 'center',
      render: (level) => <strong>{level}</strong>,
    },
    {
      title: '名称 / Name',
      dataIndex: 'name',
      key: 'name',
      width: 120,
      render: (name) => <Tag color="purple">{name}</Tag>,
    },
    {
      title: '升级需求 / Required',
      dataIndex: 'requiredPrestige',
      key: 'requiredPrestige',
      width: 120,
      align: 'right',
      render: (val) => val.toLocaleString(),
    },
    {
      title: '每日扣除 / Daily Cost',
      dataIndex: 'dailyCost',
      key: 'dailyCost',
      width: 100,
      align: 'right',
      render: (val) => val > 0 ? val.toLocaleString() : '-',
    },
    {
      title: '每日获得 / Daily Gain',
      dataIndex: 'dailyGain',
      key: 'dailyGain',
      width: 100,
      align: 'right',
      render: (val) => (
        <span style={{ color: val >= 0 ? '#52c41a' : '#f5222d' }}>
          {val >= 0 ? '+' : ''}{val}
        </span>
      ),
    },
    {
      title: '银币奖励 / Silver',
      dataIndex: 'silverReward',
      key: 'silverReward',
      width: 120,
      align: 'right',
      render: (val) => val.toLocaleString(),
    },
    {
      title: '奥义奖励 / Ultimate',
      dataIndex: 'ultimateReward',
      key: 'ultimateReward',
      width: 100,
      align: 'right',
    },
  ];
  
  // 忍阶等级选项
  const levelOptions = useMemo(() =>
    PRESTIGE_LEVELS.map(p => ({
      value: p.level,
      label: `${p.level}级 - ${p.name}`,
    })),
    []
  );
  
  // 重置配置
  const handleReset = useCallback(() => {
    setCurrentPrestige(5000);
    setTargetLevel(10);
    setDailyChallenges(10);
    setWinRate(0.5);
    message.success('已重置 / Reset complete');
  }, []);
  
  const tabItems = [
    {
      key: 'calculator',
      label: (
        <span>
          <StarOutlined /> 晋升计算 / Calculator
        </span>
      ),
      children: (
        <div className={styles.calcContent}>
          {/* 左侧配置 */}
          <div className={styles.calcPanel}>
            <Card className={styles.configCard} title="忍阶配置 / Prestige Config">
              <div className={styles.inputItem}>
                <label>当前声望 / Current Prestige:</label>
                <InputNumber
                  min={0}
                  max={1000000}
                  value={currentPrestige}
                  onChange={(v) => setCurrentPrestige(v ?? 0)}
                  style={{ width: '100%' }}
                  formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(value) => value?.replace(/,/g, '') as unknown as number ?? 0}
                />
              </div>
              
              <div className={styles.inputItem}>
                <label>目标忍阶 / Target Level:</label>
                <Select
                  style={{ width: '100%' }}
                  value={targetLevel}
                  onChange={setTargetLevel}
                  options={levelOptions}
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label as unknown as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                />
              </div>
            </Card>
            
            <Card className={styles.configCard} title="挑战配置 / Challenge Config">
              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>每日挑战 / Daily Challenges</span>
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
            {/* 当前忍阶卡片 */}
            <Card className={styles.resultCard}>
              <div className={styles.currentPrestige}>
                <div className={styles.currentHeader}>
                  <StarOutlined className={styles.starIcon} />
                  <span>当前忍阶 / Current Prestige</span>
                </div>
                <div className={styles.currentLevel}>
                  <span className={styles.levelNumber}>{prestigeInfo.currentLevel}</span>
                  <span className={styles.levelName}>{prestigeInfo.currentName}</span>
                </div>
                <Progress
                  percent={prestigeInfo.progress * 100}
                  strokeColor="#722ed1"
                  trailColor="#f0f0f0"
                  showInfo={false}
                />
                <div className={styles.progressText}>
                  {currentPrestige.toLocaleString()} / {prestigeInfo.requiredPrestige.toLocaleString()} 声望
                </div>
              </div>
            </Card>
            
            {/* 每日收益卡片 */}
            <Card className={styles.resultCard}>
              <div className={styles.rewardHeader}>
                <ThunderboltOutlined />
                <span>每日声望收益 / Daily Prestige Gain</span>
              </div>
              <div className={styles.rewardContent}>
                <div className={styles.rewardValue} style={{ color: dailyPrestigeGain >= 0 ? '#52c41a' : '#f5222d' }}>
                  {dailyPrestigeGain >= 0 ? '+' : ''}{dailyPrestigeGain.toLocaleString()}
                </div>
                <div className={styles.rewardLabel}>声望/天 / Prestige/Day</div>
              </div>
              <div className={styles.rewardBreakdown}>
                <div className={styles.breakdownItem}>
                  <span>基础收益 / Base</span>
                  <span>{currentLevelData?.dailyGain ?? 0}</span>
                </div>
                <div className={styles.breakdownItem}>
                  <span>挑战收益 / Challenges</span>
                  <span>{Math.floor(dailyChallenges * winRate * (currentLevelData?.winPrestige ?? 0))}</span>
                </div>
              </div>
            </Card>
            
            {/* 晋升预估卡片 */}
            <Card className={styles.rankUpCard}>
              <div className={styles.rankUpHeader}>
                <ArrowUpOutlined />
                <span>晋升预估 / Promotion Estimate</span>
              </div>
              <div className={styles.rankUpContent}>
                <div className={styles.rankUpRange}>
                  <Tag color="purple">{prestigeInfo.currentLevel}级 {prestigeInfo.currentName}</Tag>
                  <span>→</span>
                  <Tag color="gold">{targetLevel}级 {getPrestigeLevelByLevel(targetLevel)?.name}</Tag>
                </div>
                
                {daysToTarget === 0 ? (
                  <div className={styles.rankUpComplete}>
                    <StarOutlined /> 已达到目标等级！
                  </div>
                ) : daysToTarget === Infinity ? (
                  <div className={styles.rankUpWarning}>
                    声望收益不足，无法晋升
                  </div>
                ) : daysToTarget > 365 ? (
                  <div className={styles.rankUpWarning}>
                    预计需要 {Math.ceil(daysToTarget / 30)} 个月以上
                  </div>
                ) : (
                  <div className={styles.rankUpDays}>
                    <span className={styles.daysNumber}>{daysToTarget}</span>
                    <span className={styles.daysLabel}>天 / Days</span>
                  </div>
                )}
              </div>
            </Card>
            
            {/* 忍阶说明卡片 */}
            <Card className={styles.infoCard}>
              <div className={styles.infoHeader}>忍阶说明 / Prestige Info</div>
              <div className={styles.tierList}>
                {Object.entries(PRESTIGE_TIERS).map(([key, tier]) => (
                  <div key={key} className={styles.tierItem}>
                    <Tag color={tier.color}>{tier.label}</Tag>
                    <span className={styles.tierRange}>{tier.minLevel}-{tier.maxLevel}级</span>
                    {prestigeInfo.currentLevel >= tier.minLevel && prestigeInfo.currentLevel <= tier.maxLevel && (
                      <Tag color="green">当前</Tag>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      ),
    },
    {
      key: 'levels',
      label: (
        <span>
          <StarOutlined /> 忍阶列表 / Levels
        </span>
      ),
      children: (
        <Card className={styles.tableCard}>
          <Table
            columns={prestigeColumns}
            dataSource={PRESTIGE_LEVELS}
            pagination={{ pageSize: 10 }}
            size="small"
            rowKey="level"
          />
        </Card>
      ),
    },
  ];
  
  return (
    <div className={styles.container}>
      {/* 面包屑导航 */}
      <Breadcrumb
        className={styles.breadcrumb}
        items={[
          { title: <Link href="/economy-simulator"><HomeOutlined /> 经济模拟</Link> },
          { title: <span><StarOutlined /> 忍阶声望 / Prestige</span> },
        ]}
      />

      {/* 顶部导航 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>⭐</span>
          <div className={styles.headerTitle}>
            <h1>忍阶声望 / Prestige</h1>
            <p>忍阶晋升与声望计算</p>
          </div>
        </div>
        <Link href="/economy-simulator" className={styles.backButton}>
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
