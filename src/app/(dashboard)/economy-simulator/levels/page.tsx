'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Button, InputNumber, Select, Card, Table, Tag, Space, message, Breadcrumb, Statistic, Row, Col, Alert } from 'antd';
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

  // 计算总收益
  const totalRewards = useMemo(() => {
    let silver = 0;
    let exp = 0;
    let gold = 0;

    for (const level of filteredLevels) {
      const reward = calculateLevelReward(level, playerLevel);
      silver += reward.silver;
      exp += reward.exp;
      gold += reward.gold;
    }

    return { silver, exp, gold };
  }, [filteredLevels, playerLevel]);

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
        const r = calculateLevelReward(record, playerLevel);
        return <span style={{ color: '#fa8c16' }}>{r.silver}</span>;
      },
    },
    {
      title: '经验',
      key: 'exp',
      width: 70,
      align: 'right',
      render: (_, record) => {
        const r = calculateLevelReward(record, playerLevel);
        return <span style={{ color: '#1890ff' }}>{r.exp}</span>;
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
      const reward = calculateLevelReward(level, playerLevel);
      const cost = parseLevelCost(level.cost);
      return {
        key: level.id,
        name: level.name,
        type: level.type,
        costAmount: cost?.type === 'stamina' ? cost.amount : 0,
        silver: reward.silver,
        exp: reward.exp,
      };
    });
  }, [filteredLevels, playerLevel]);

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
      {/* 面包屑 */}
      <Breadcrumb
        className={styles.breadcrumb}
        items={[
          { title: <Link href="/economy-simulator"><HomeOutlined /> 经济模拟</Link> },
          { title: <><BankOutlined /> 关卡系统 / Levels</> },
        ]}
      />

      {/* 主内容 */}
      <main className={styles.mainContent}>
        <Row gutter={24}>
          {/* 左侧配置 */}
          <Col span={8}>
            <Card className={styles.configCard} title="基础配置 / Basic Config">
              <div className={styles.configSection}>
                <label className={styles.configLabel}>主将等级 / Player Level</label>
                <InputNumber
                  min={1}
                  max={200}
                  value={playerLevel}
                  onChange={(v) => setPlayerLevel(v ?? 1)}
                  style={{ width: '100%' }}
                />
              </div>

              <div className={styles.configSection}>
                <label className={styles.configLabel}>关卡类型 / Level Type</label>
                <Select
                  style={{ width: '100%' }}
                  value={selectedType}
                  onChange={setSelectedType}
                  options={typeOptions}
                />
                {selectedType && (
                  <div className={styles.typeInfo}>
                    <Tag color={LEVEL_TYPE_CONFIG[selectedType].color}>
                      {LEVEL_TYPE_CONFIG[selectedType].label}
                    </Tag>
                    <span className={styles.typeStats}>
                      {typeStats.count} 关 | 均 {typeStats.avgStamina} 体力
                    </span>
                  </div>
                )}
              </div>
            </Card>

            <Card className={styles.configCard} title="操作 / Actions">
              <div className={styles.actionButtons}>
                <Button onClick={selectAllCurrentType}>全选 / Select All</Button>
                <Button onClick={clearAllSelection}>清空 / Clear</Button>
                <Button danger onClick={handleReset}>重置 / Reset</Button>
              </div>
            </Card>

            <Card className={styles.configCard} title="体力配置 / Stamina Config">
              <div className={styles.configInfo}>
                <span>恢复间隔: {STAMINA_CONFIG.recoveryInterval} 分钟</span>
                <span>最大体力: {STAMINA_CONFIG.maxStamina}</span>
              </div>
            </Card>
          </Col>

          {/* 右侧结果 */}
          <Col span={16}>
            {/* 统计卡片 */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Card className={styles.statCard}>
                  <Statistic
                    title="已选关卡"
                    value={typeStats.count}
                    prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card className={styles.statCard}>
                  <Statistic
                    title="体力消耗"
                    value={totalStaminaCost}
                    prefix={<ThunderboltOutlined style={{ color: '#1890ff' }} />}
                    valueStyle={{ color: '#1890ff' }}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card className={styles.statCard}>
                  <Statistic
                    title="恢复时间"
                    value={recoveryTime > 0 ? formatRecoveryTime(recoveryTime) : '充足'}
                    valueStyle={{ color: recoveryTime > 0 ? '#fa8c16' : '#52c41a' }}
                  />
                </Card>
              </Col>
            </Row>

            {/* 收益卡片 */}
            <Card className={styles.resultCard} style={{ marginBottom: 16 }}>
              <div className={styles.resultHeader}>
                <span>收益统计 / Rewards</span>
                <Tag color="blue">Lv.{playerLevel}</Tag>
              </div>
              <Row gutter={16}>
                <Col span={12}>
                  <div className={styles.rewardItem}>
                    <DollarOutlined className={styles.rewardIcon} />
                    <div>
                      <div className={styles.rewardValue}>{totalRewards.silver.toLocaleString()}</div>
                      <div className={styles.rewardLabel}>银币 / Silver</div>
                    </div>
                  </div>
                </Col>
                <Col span={12}>
                  <div className={styles.rewardItem}>
                    <ExperimentOutlined className={styles.rewardIcon} />
                    <div>
                      <div className={styles.rewardValue}>{totalRewards.exp.toLocaleString()}</div>
                      <div className={styles.rewardLabel}>经验 / EXP</div>
                    </div>
                  </div>
                </Col>
              </Row>
            </Card>

            {/* 收益明细 */}
            <Card className={styles.resultCard}>
              <div className={styles.resultHeader}>
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
                  scroll={{ y: 300 }}
                />
              ) : (
                <Alert message="请先选择关卡 / Please select levels" type="info" showIcon />
              )}
            </Card>
          </Col>
        </Row>

        {/* 关卡列表 */}
        <Card className={styles.tableCard} title="关卡列表 / Level List" style={{ marginTop: 24 }}>
          <div className={styles.filterBar}>
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
      </main>
    </div>
  );
}
