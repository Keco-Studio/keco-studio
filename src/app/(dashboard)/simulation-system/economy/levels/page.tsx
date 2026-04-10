'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Button, InputNumber, Select, Card, Table, Tag, Space, message, Breadcrumb, Row, Col, Alert } from 'antd';
import {
  BankOutlined,
  ThunderboltOutlined,
  DollarOutlined,
  ExperimentOutlined,
  HomeOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  LEVELS,
  LEVEL_TYPE_CONFIG,
  STAMINA_CONFIG,
  getLevelById,
  getLevelsByType,
  parseLevelCost,
  calculateLevelReward,
  calculateTotalStaminaCost,
  formatRecoveryTime,
} from '../data/levels';
import type { Level, LevelType } from '../types';
import styles from './Levels.module.css';

export default function LevelsPage() {
  // 当前标签页
  const [activeTab, setActiveTab] = useState<string>('calculator');

  // 主将等级
  const [playerLevel, setPlayerLevel] = useState<number>(100);

  // 选中的关卡ID列表
  const [selectedLevelIds, setSelectedLevelIds] = useState<number[]>([100001, 100002, 100003]);

  // 选中的关卡类型
  const [selectedType, setSelectedType] = useState<LevelType | null>(null);

  // 是否首次通关模式（首次通关奖励更高）
  const [isFirstTime, setIsFirstTime] = useState<boolean>(false);

  // ============ 动态计算 ============

  // 根据选中类型从已选关卡中过滤
  const filteredLevels = useMemo(() => {
    const selected = selectedLevelIds
      .map(id => getLevelById(id))
      .filter((l): l is Level => l !== undefined);

    if (!selectedType) {
      return selected;
    }
    return selected.filter(l => l.type === selectedType);
  }, [selectedLevelIds, selectedType]);

  // 当前选中类型的统计信息
  const typeStats = useMemo(() => {
    const selected = selectedLevelIds
      .map(id => getLevelById(id))
      .filter((l): l is Level => l !== undefined);

    if (!selectedType) {
      return {
        count: selected.length,
        avgStamina: selected.length > 0 ? Math.round(selected.reduce((sum, l) => {
          const cost = parseLevelCost(l.cost);
          return sum + (cost?.type === 'stamina' ? cost.amount : 0);
        }, 0) / selected.length) : 0,
        totalStamina: calculateTotalStaminaCost(selectedLevelIds),
      };
    }
    const levels = selected.filter(l => l.type === selectedType);
    return {
      count: levels.length,
      avgStamina: levels.length > 0 ? Math.round(levels.reduce((sum, l) => {
        const cost = parseLevelCost(l.cost);
        return sum + (cost?.type === 'stamina' ? cost.amount : 0);
      }, 0) / levels.length) : 0,
      totalStamina: calculateTotalStaminaCost(levels.map(l => l.id)),
    };
  }, [selectedLevelIds, selectedType]);

  // 计算总消耗
  const totalStaminaCost = useMemo(() => {
    return calculateTotalStaminaCost(filteredLevels.map(l => l.id));
  }, [filteredLevels]);

  // 计算总收益（根据是否首次通关）
  const totalRewards = useMemo(() => {
    let silver = 0;
    let exp = 0;
    let gold = 0;

    for (const level of filteredLevels) {
      const reward = calculateLevelReward(level, playerLevel, isFirstTime);
      silver += reward.silver;
      exp += reward.exp;
      gold += reward.gold;
    }

    return { silver, exp, gold };
  }, [filteredLevels, playerLevel, isFirstTime]);

  // 体力恢复时间
  const recoveryTime = useMemo(() => {
    if (totalStaminaCost <= STAMINA_CONFIG.maxStamina) {
      return 0;
    }
    const needed = totalStaminaCost - STAMINA_CONFIG.maxStamina;
    return needed * STAMINA_CONFIG.recoveryInterval;
  }, [totalStaminaCost]);

  // ============ 操作函数 ============

  const toggleLevel = useCallback((id: number) => {
    setSelectedLevelIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      }
      return [...prev, id];
    });
  }, []);

  const selectAllCurrentType = useCallback(() => {
    const levels = selectedType ? getLevelsByType(selectedType) : LEVELS;
    setSelectedLevelIds(levels.map(l => l.id));
    message.success(`已选择全部 / All selected: ${levels.length}`);
  }, [selectedType]);

  const clearAllSelection = useCallback(() => {
    setSelectedLevelIds([]);
    message.success('已清空选择 / Cleared');
  }, []);

  const handleReset = useCallback(() => {
    setSelectedLevelIds([]);
    setPlayerLevel(100);
    setSelectedType(null);
    message.success('已重置 / Reset complete');
  }, []);

  // ============ 表格列 ============

  const levelColumns: ColumnsType<Level> = [
    {
      title: '关卡名 / Name',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      render: (name, record) => (
        <span>
          <Tag color={LEVEL_TYPE_CONFIG[record.type].color} style={{ marginRight: 6, fontSize: 10 }}>
            {record.type.split('·')[0]}
          </Tag>
          {name}
        </span>
      ),
    },
    {
      title: '消耗',
      key: 'cost',
      width: 90,
      align: 'center',
      render: (_, record) => {
        const cost = parseLevelCost(record.cost);
        if (!cost) return '-';
        if (cost.type === 'none') return <Tag color="green">免费</Tag>;
        if (cost.type === 'stamina') return <Tag color="blue">{cost.amount}</Tag>;
        if (cost.type === 'reset') return <Tag color="orange">重置</Tag>;
        return '-';
      },
    },
    {
      title: '银币',
      key: 'silver',
      width: 90,
      align: 'right',
      render: (_, record) => {
        const r = calculateLevelReward(record, playerLevel, isFirstTime);
        return <span style={{ color: '#fa8c16' }}>{r.silver.toLocaleString()}</span>;
      },
    },
    {
      title: '经验',
      key: 'exp',
      width: 70,
      align: 'right',
      render: (_, record) => {
        const r = calculateLevelReward(record, playerLevel, isFirstTime);
        return <span style={{ color: '#1890ff' }}>{r.exp.toLocaleString()}</span>;
      },
    },
    {
      title: '元宝',
      key: 'gold',
      width: 70,
      align: 'right',
      render: (_, record) => {
        const r = calculateLevelReward(record, playerLevel, isFirstTime);
        return <span style={{ color: '#722ed1' }}>{r.gold}</span>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 70,
      align: 'center',
      render: (_, record) => (
        <Button
          type={selectedLevelIds.includes(record.id) ? 'primary' : 'default'}
          size="small"
          onClick={() => toggleLevel(record.id)}
        >
          {selectedLevelIds.includes(record.id) ? '已选' : '选择'}
        </Button>
      ),
    },
  ];

  const rewardColumns: ColumnsType<{
    key: number;
    name: string;
    type: LevelType;
    costAmount: number;
    silver: number;
    exp: number;
    gold: number;
  }> = [
    {
      title: '关卡',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '体力',
      dataIndex: 'costAmount',
      key: 'costAmount',
      width: 70,
      align: 'center',
      render: (val) => val > 0 ? `${val}` : '免费',
    },
    {
      title: '银币',
      dataIndex: 'silver',
      key: 'silver',
      width: 100,
      align: 'right',
      render: (val) => val.toLocaleString(),
    },
    {
      title: '经验',
      dataIndex: 'exp',
      key: 'exp',
      width: 80,
      align: 'right',
      render: (val) => val.toLocaleString(),
    },
    {
      title: '元宝',
      dataIndex: 'gold',
      key: 'gold',
      width: 70,
      align: 'right',
      render: (val) => (
        <span style={{ color: val > 0 ? '#722ed1' : '#8c8c8c' }}>
          {val > 0 ? val : '-'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      align: 'center',
      render: (_, record) => (
        <Button type="text" danger size="small" onClick={() => toggleLevel(record.key)}>
          移除
        </Button>
      ),
    },
  ];

  const rewardTableData = useMemo(() => {
    return filteredLevels.map(level => {
      const reward = calculateLevelReward(level, playerLevel, isFirstTime);
      const cost = parseLevelCost(level.cost);
      return {
        key: level.id,
        name: level.name,
        type: level.type,
        costAmount: cost?.type === 'stamina' ? cost.amount : 0,
        silver: reward.silver,
        exp: reward.exp,
        gold: reward.gold,
      };
    });
  }, [filteredLevels, playerLevel, isFirstTime]);

  // 类型选项
  const typeOptions = useMemo(() => {
    const selected = selectedLevelIds
      .map(id => getLevelById(id))
      .filter((l): l is Level => l !== undefined);

    const typeCounts: Record<string, number> = {};
    selected.forEach(l => {
      typeCounts[l.type] = (typeCounts[l.type] || 0) + 1;
    });

    return [
      { value: null, label: `全部 (${selected.length})` },
      ...Object.entries(LEVEL_TYPE_CONFIG).map(([key, config]) => ({
        value: key as LevelType,
        label: `${config.label} (${typeCounts[key] || 0})`,
      })),
    ];
  }, [selectedLevelIds]);

  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>🏦</span>
          <div className={styles.headerTitle}>
            <h1>关卡系统 / Levels</h1>
            <p>关卡消耗与收益计算</p>
          </div>
        </div>
        <Link href="/simulation-system/economy/overview" className={styles.backButton}>
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
                <label>主将等级 / Player Level</label>
                <InputNumber
                  min={1}
                  max={200}
                  value={playerLevel}
                  onChange={(v) => setPlayerLevel(v ?? 1)}
                  style={{ width: '100%' }}
                />
              </div>

              <div className={styles.inputItem}>
                <label>关卡类型 / Level Type</label>
                <Select
                  style={{ width: '100%' }}
                  value={selectedType}
                  onChange={setSelectedType}
                  options={typeOptions}
                />
                {selectedType && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                    <Tag color={LEVEL_TYPE_CONFIG[selectedType].color}>
                      {LEVEL_TYPE_CONFIG[selectedType].label}
                    </Tag>
                    <span> {typeStats.count} 关 | 均 {typeStats.avgStamina} 体力</span>
                  </div>
                )}
              </div>

              <div className={styles.inputItem}>
                <label>通关模式 / Pass Mode</label>
                <Select
                  style={{ width: '100%' }}
                  value={isFirstTime}
                  onChange={(v) => setIsFirstTime(v ?? false)}
                  options={[
                    { value: false, label: '重复通关 (普通奖励)' },
                    { value: true, label: '首次通关 (2.5倍奖励 + 元宝)' },
                  ]}
                />
                {isFirstTime && (
                  <div style={{ marginTop: 8 }}>
                    <Tag color="gold">首次通关加成 x2.5</Tag>
                    <Tag color="purple">额外元宝奖励</Tag>
                  </div>
                )}
              </div>
            </Card>

            <Card className={styles.configCard} title="操作 / Actions">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Button onClick={selectAllCurrentType}>全选 / Select All</Button>
                <Button onClick={clearAllSelection}>清空 / Clear</Button>
                <Button danger onClick={handleReset}>重置 / Reset</Button>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#8c8c8c' }}>
                <div>恢复间隔: {STAMINA_CONFIG.recoveryInterval} 分钟</div>
                <div>最大体力: {STAMINA_CONFIG.maxStamina}</div>
              </div>
            </Card>
          </div>

          {/* 右侧结果 */}
          <div className={styles.calcResults}>
            {/* 统计卡片 */}
            <Card className={styles.summaryCard}>
              <div className={styles.summaryHeader}>
                <span>已选 {typeStats.count} 关卡</span>
                <Tag color={isFirstTime ? 'gold' : 'blue'}>
                  {isFirstTime ? '首次通关' : '重复通关'}
                </Tag>
              </div>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <div className={styles.summaryValue} style={{ color: '#52c41a' }}>{typeStats.count}</div>
                  <div className={styles.summaryLabel}>已选关卡</div>
                </div>
                <div className={styles.summaryItem}>
                  <div className={styles.summaryValue} style={{ color: '#1890ff' }}>{totalStaminaCost}</div>
                  <div className={styles.summaryLabel}>体力消耗</div>
                </div>
                <div className={styles.summaryItem}>
                  <div className={styles.summaryValue} style={{ color: recoveryTime > 0 ? '#fa8c16' : '#52c41a' }}>
                    {recoveryTime > 0 ? formatRecoveryTime(recoveryTime) : '充足'}
                  </div>
                  <div className={styles.summaryLabel}>恢复时间</div>
                </div>
              </div>
            </Card>

            {/* 收益卡片 */}
            <Card className={styles.resultCard}>
              <div className={styles.rewardHeader}>
                <span>收益统计 / Rewards</span>
              </div>
              <div className={styles.rewardGrid}>
                <div className={styles.rewardItem}>
                  <DollarOutlined className={styles.rewardIcon} />
                  <div className={styles.rewardContent}>
                    <div className={styles.rewardValue}>{totalRewards.silver.toLocaleString()}</div>
                    <div className={styles.rewardLabel}>银币 / Silver</div>
                  </div>
                </div>
                <div className={styles.rewardItem}>
                  <ExperimentOutlined className={styles.expIcon} />
                  <div className={styles.rewardContent}>
                    <div className={styles.rewardValue}>{totalRewards.exp.toLocaleString()}</div>
                    <div className={styles.rewardLabel}>经验 / EXP</div>
                  </div>
                </div>
                <div className={styles.rewardItem}>
                  <DollarOutlined className={styles.goldIcon} />
                  <div className={styles.rewardContent}>
                    <div className={styles.rewardValue} style={{ color: '#722ed1' }}>
                      {totalRewards.gold > 0 ? totalRewards.gold : '-'}
                    </div>
                    <div className={styles.rewardLabel}>元宝 / Gold</div>
                  </div>
                </div>
              </div>
            </Card>

            {/* 收益明细表格 */}
            <Card className={styles.tableCard}>
              <div className={styles.rewardHeader}>
                <span>收益明细 / Details</span>
                <Tag>{filteredLevels.length} 关卡</Tag>
              </div>
              {rewardTableData.length > 0 ? (
                <Table
                  columns={rewardColumns}
                  dataSource={rewardTableData}
                  pagination={false}
                  size="small"
                  rowKey="key"
                  scroll={{ y: 250 }}
                />
              ) : (
                <Alert message="请先选择关卡 / Please select levels" type="info" showIcon />
              )}
            </Card>

            {/* 关卡列表 */}
            <Card className={styles.tableCard} title="关卡列表 / Level List">
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Select
                  placeholder="筛选类型"
                  style={{ width: 180 }}
                  value={selectedType}
                  onChange={setSelectedType}
                  options={typeOptions}
                />
                <Space>
                  <Button type="primary" onClick={selectAllCurrentType}>全选当前类型</Button>
                  <Button onClick={clearAllSelection}>清空已选</Button>
                </Space>
              </div>
              <Table
                columns={levelColumns}
                dataSource={selectedType ? getLevelsByType(selectedType) : LEVELS}
                pagination={{ pageSize: 10 }}
                size="small"
                rowKey="id"
              />
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
