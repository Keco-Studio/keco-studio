'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Card, Select, InputNumber, Table, Tag, Button, Slider, Tabs, message, Empty, Breadcrumb } from 'antd';
import {
  ShoppingOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  UnorderedListOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  EQUIPMENTS,
  EQUIPMENT_SLOT_NAMES,
  EQUIPMENT_SERIES,
  getEquipmentById,
  calculateEnhanceCost,
  getEquipmentQualityColor,
} from '../data/equipment';
import { type Equipment, QUALITY_COLORS } from '../types';
import styles from './Equipment.module.css';

/** 装备系统页面 */
export default function EquipmentPage() {
  // 当前标签页
  const [activeTab, setActiveTab] = useState<string>('calculator');

  // 选中的装备
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<number>(14200001);

  // 当前强化等级
  const [currentLevel, setCurrentLevel] = useState<number>(0);

  // 目标强化等级
  const [targetLevel, setTargetLevel] = useState<number>(10);

  // 装备槽位筛选
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

  // 装备品质筛选
  const [selectedQuality, setSelectedQuality] = useState<number | null>(null);

  // 装备系列筛选
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);

  // 获取当前装备
  const selectedEquipment = useMemo(
    () => getEquipmentById(selectedEquipmentId),
    [selectedEquipmentId]
  );

  // 计算强化费用
  const enhanceCost = useMemo(() => {
    if (!selectedEquipment) return 0;
    return calculateEnhanceCost(currentLevel, targetLevel, selectedEquipment.enhanceCost);
  }, [selectedEquipment, currentLevel, targetLevel]);

  // 获取装备选项
  const equipmentOptions = useMemo(() => {
    let filtered = EQUIPMENTS;

    if (selectedSlot !== null) {
      filtered = filtered.filter(e => e.subType === selectedSlot);
    }

    if (selectedQuality !== null) {
      filtered = filtered.filter(e => e.quality === selectedQuality);
    }

    if (selectedSeries !== null) {
      filtered = filtered.filter(e => e.name.includes(selectedSeries));
    }

    return filtered.map(e => ({
      value: e.id,
      label: (
        <span>
          <Tag color={getEquipmentQualityColor(e.quality)}>
            {e.qualityText} Lv.{e.level}
          </Tag>
          {e.name}
        </span>
      ),
    }));
  }, [selectedSlot, selectedQuality, selectedSeries]);

  // 装备列表表格列
  const equipmentColumns: ColumnsType<Equipment> = [
    {
      title: '装备名 / Name',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (name, record) => (
        <span>
          <Tag color={getEquipmentQualityColor(record.quality)} style={{ marginRight: 8 }}>
            {record.qualityText}
          </Tag>
          {name}
        </span>
      ),
    },
    {
      title: '等级 / Level',
      dataIndex: 'level',
      key: 'level',
      width: 80,
      align: 'center',
    },
    {
      title: '品质 / Quality',
      dataIndex: 'quality',
      key: 'quality',
      width: 80,
      align: 'center',
      render: (quality) => (
        <Tag color={QUALITY_COLORS[quality]}>
          {quality === 7 ? '神铸' : quality >= 4 ? '高级' : '普通'}
        </Tag>
      ),
    },
    {
      title: '槽位 / Slot',
      key: 'slot',
      width: 100,
      align: 'center',
      render: (_, record) => EQUIPMENT_SLOT_NAMES[record.subType] || '-',
    },
    {
      title: '开放等级 / Open Level',
      dataIndex: 'openLevel',
      key: 'openLevel',
      width: 100,
      align: 'center',
    },
    {
      title: '强化费用 / Enhance Cost',
      dataIndex: 'enhanceCost',
      key: 'enhanceCost',
      width: 120,
      align: 'right',
      render: (cost) => cost > 0 ? cost.toLocaleString() : '-',
    },
    {
      title: '操作 / Action',
      key: 'action',
      width: 100,
      align: 'center',
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => setSelectedEquipmentId(record.id)}
        >
          选择 / Select
        </Button>
      ),
    },
  ];

  // 强化计算表格数据
  const enhanceTableData = useMemo(() => {
    if (!selectedEquipment) return [];

    const data = [];
    for (let lvl = currentLevel; lvl <= targetLevel; lvl++) {
      const prevCost = calculateEnhanceCost(currentLevel, lvl, selectedEquipment.enhanceCost);
      const isCurrent = lvl === currentLevel;
      const isTarget = lvl === targetLevel;

      data.push({
        key: lvl,
        level: lvl,
        cost: prevCost,
        isCurrent,
        isTarget,
      });
    }

    return data;
  }, [selectedEquipment, currentLevel, targetLevel]);

  // 强化表格列
  const enhanceColumns: ColumnsType<{
    key: number;
    level: number;
    cost: number;
    isCurrent: boolean;
    isTarget: boolean;
  }> = [
      {
        title: '等级 / Level',
        dataIndex: 'level',
        key: 'level',
        width: 100,
        align: 'center',
        render: (level, record) => (
          <span>
            {record.isCurrent && <Tag color="blue" style={{ marginRight: 4 }}>当前</Tag>}
            {record.isTarget && <Tag color="green" style={{ marginRight: 4 }}>目标</Tag>}
            +{level}
          </span>
        ),
      },
      {
        title: '累计费用 / Total Cost',
        dataIndex: 'cost',
        key: 'cost',
        align: 'right',
        render: (cost) => cost.toLocaleString() + ' 银币',
      },
    ];

  // 重置配置
  const handleReset = useCallback(() => {
    setCurrentLevel(0);
    setTargetLevel(10);
    message.success('已重置 / Reset complete');
  }, []);

  // 槽位选项
  const slotOptions = [
    { value: null, label: '全部 / All' },
    ...Object.entries(EQUIPMENT_SLOT_NAMES).map(([key, name]) => ({
      value: parseInt(key),
      label: name,
    })),
  ];

  // 品质选项
  const qualityOptions = [
    { value: null, label: '全部 / All' },
    { value: 7, label: '神铸 (7阶)' },
    { value: 6, label: '红色 (6阶)' },
    { value: 5, label: '橙色 (5阶)' },
    { value: 4, label: '紫色 (4阶)' },
    { value: 3, label: '蓝色 (3阶)' },
    { value: 2, label: '高级 (2阶)' },
    { value: 1, label: '普通 (1阶)' },
  ];

  // 系列选项
  const seriesOptions = [
    { value: null, label: '全部 / All' },
    ...EQUIPMENT_SERIES.map(series => ({
      value: series,
      label: series,
    })),
  ];

  const tabItems = [
    {
      key: 'calculator',
      label: (
        <span>
          <ToolOutlined /> 强化计算 / Calculator
        </span>
      ),
      children: (
        <div className={styles.calcContent}>
          {/* 左侧配置 */}
          <div className={styles.calcPanel}>
            <Card className={styles.configCard} title="装备选择 / Equipment Select">
              <Select
                style={{ width: '100%' }}
                value={selectedEquipmentId}
                onChange={setSelectedEquipmentId}
                options={equipmentOptions}
                showSearch
                filterOption={(input, option) =>
                  (option?.label as unknown as string)?.toLowerCase().includes(input.toLowerCase())
                }
              />

              {selectedEquipment && (
                <div className={styles.equipInfo}>
                  <div className={styles.equipHeader}>
                    <Tag color={getEquipmentQualityColor(selectedEquipment.quality)} style={{ fontSize: 14 }}>
                      {selectedEquipment.qualityText}
                    </Tag>
                    <span className={styles.equipLevel}>等级 {selectedEquipment.level}</span>
                  </div>
                  <div className={styles.equipName}>{selectedEquipment.name}</div>
                  <div className={styles.equipStats}>
                    <span>槽位: {EQUIPMENT_SLOT_NAMES[selectedEquipment.subType] || '-'}</span>
                    <span>开放等级: {selectedEquipment.openLevel}</span>
                  </div>
                </div>
              )}
            </Card>

            <Card className={styles.configCard} title="强化配置 / Enhance Config">
              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>当前等级 / Current Level</span>
                  <strong>+{currentLevel}</strong>
                </div>
                <Slider
                  min={0}
                  max={targetLevel - 1}
                  value={currentLevel}
                  onChange={setCurrentLevel}
                />
              </div>

              <div className={styles.sliderItem}>
                <div className={styles.sliderLabel}>
                  <span>目标等级 / Target Level</span>
                  <strong>+{targetLevel}</strong>
                </div>
                <Slider
                  min={currentLevel + 1}
                  max={50}
                  value={targetLevel}
                  onChange={setTargetLevel}
                />
              </div>

              <Button type="default" onClick={handleReset} block>
                重置 / Reset
              </Button>
            </Card>
          </div>

          {/* 右侧结果 */}
          <div className={styles.calcResults}>
            <Card className={styles.resultCard}>
              <div className={styles.costSummary}>
                <div className={styles.costIcon}>
                  <ShoppingOutlined />
                </div>
                <div className={styles.costContent}>
                  <div className={styles.costValue}>{enhanceCost.toLocaleString()}</div>
                  <div className={styles.costLabel}>强化费用 / Enhance Cost</div>
                </div>
              </div>

              <div className={styles.levelRange}>
                <Tag color="blue">+{currentLevel}</Tag>
                <span>→</span>
                <Tag color="green">+{targetLevel}</Tag>
                <span className={styles.levelDiff}>(+{targetLevel - currentLevel}级)</span>
              </div>
            </Card>

            <Card className={styles.resultCard} title="强化明细 / Enhance Details">
              <Table
                columns={enhanceColumns}
                dataSource={enhanceTableData}
                pagination={false}
                size="small"
                scroll={{ y: 300 }}
                rowKey="key"
              />
            </Card>
          </div>
        </div>
      ),
    },
    {
      key: 'list',
      label: (
        <span>
          <UnorderedListOutlined /> 装备列表 / List
        </span>
      ),
      children: (
        <div className={styles.listContent}>
          <Card className={styles.filterCard}>
            <div className={styles.filterRow}>
              <div className={styles.filterItem}>
                <label>槽位 / Slot:</label>
                <Select
                  style={{ width: 120 }}
                  value={selectedSlot}
                  onChange={setSelectedSlot}
                  options={slotOptions}
                />
              </div>
              <div className={styles.filterItem}>
                <label>品质 / Quality:</label>
                <Select
                  style={{ width: 140 }}
                  value={selectedQuality}
                  onChange={setSelectedQuality}
                  options={qualityOptions}
                />
              </div>
              <div className={styles.filterItem}>
                <label>系列 / Series:</label>
                <Select
                  style={{ width: 120 }}
                  value={selectedSeries}
                  onChange={setSelectedSeries}
                  options={seriesOptions}
                  showSearch
                />
              </div>
              <Button onClick={() => {
                setSelectedSlot(null);
                setSelectedQuality(null);
                setSelectedSeries(null);
              }}>
                重置筛选 / Reset
              </Button>
            </div>
          </Card>

          <Card className={styles.tableCard}>
            <Table
              columns={equipmentColumns}
              dataSource={equipmentOptions.map(opt => ({
                id: opt.value,
                name: opt.label as unknown as string,
                ...EQUIPMENTS.find(e => e.id === opt.value),
              }))}
              pagination={{ pageSize: 15 }}
              size="small"
              scroll={{ x: 800 }}
              rowKey="id"
            />
          </Card>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>⚔️</span>
          <div className={styles.headerTitle}>
            <h1>装备系统 / Equipment</h1>
            <p>装备强化、打造与属性计算</p>
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
