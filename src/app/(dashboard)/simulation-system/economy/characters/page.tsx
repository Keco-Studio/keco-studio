'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Card, Select, InputNumber, Table, Tag, Button, Space, Slider, message, Breadcrumb } from 'antd';
import {
  UserOutlined,
  ThunderboltOutlined,
  SafetyOutlined,
  HeartOutlined,
  ExperimentOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  CHARACTERS,
  TALENTS,
  SKILLS,
  CAMPS,
  RARITIES,
  getCharacterById,
  getTalentById,
  getSkillById,
  calculateCharacterStats,
} from '../data/characters';
import { CAMP_COLORS, RARITY_CONFIG, type Character, type CharacterBaseStats } from '../types';
import styles from './Characters.module.css';

/** 角色养成计算器页面 */
export default function CharactersPage() {
  // 选中的武将
  const [selectedCharacterId, setSelectedCharacterId] = useState<number>(1001);

  // 天赋等级 (1-12)
  const [talentLevel, setTalentLevel] = useState<number>(1);

  // 强化等级
  const [enhanceLevel, setEnhanceLevel] = useState<number>(0);

  // 星级 (1-6)
  const [starLevel, setStarLevel] = useState<number>(1);

  // 获取当前武将
  const selectedCharacter = useMemo(
    () => getCharacterById(selectedCharacterId),
    [selectedCharacterId]
  );

  // 计算当前属性
  const currentStats = useMemo(() => {
    if (!selectedCharacter) return null;

    const baseStats = calculateCharacterStats(selectedCharacter, talentLevel);

    // 强化加成 (每级+5%)
    const enhanceMultiplier = 1 + enhanceLevel * 0.05;

    // 星级加成 (每星+10%)
    const starMultiplier = 1 + (starLevel - 1) * 0.1;

    return {
      atk: Math.floor(baseStats.atk * enhanceMultiplier * starMultiplier),
      life: Math.floor(baseStats.life * enhanceMultiplier * starMultiplier),
      def: Math.floor(baseStats.def * enhanceMultiplier * starMultiplier),
      mdf: Math.floor(baseStats.mdf * enhanceMultiplier * starMultiplier),
    };
  }, [selectedCharacter, talentLevel, enhanceLevel, starLevel]);

  // 获取天赋列表
  const characterTalents = useMemo(() => {
    if (!selectedCharacter) return [];
    return selectedCharacter.talentIds
      .map(id => getTalentById(id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);
  }, [selectedCharacter]);

  // 获取技能列表
  const characterSkills = useMemo(() => {
    if (!selectedCharacter) return [];
    return selectedCharacter.skillIds
      .map(id => getSkillById(id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
  }, [selectedCharacter]);

  // 武将选择选项
  const characterOptions = useMemo(() =>
    CHARACTERS.map(c => ({
      value: c.id,
      label: (
        <span>
          <Tag color={CAMP_COLORS[c.camp]} style={{ marginRight: 8 }}>
            {c.camp}
          </Tag>
          <Tag color={RARITY_CONFIG[c.rarity].color}>
            {RARITY_CONFIG[c.rarity].label}
          </Tag>
          {c.name} (资质{c.int})
        </span>
      ),
    })),
    []
  );

  // 属性表格列
  const statColumns: ColumnsType<{ key: string; label: string; base: number; enhanced: number; total: number }> = [
    {
      title: '属性 / Stat',
      dataIndex: 'label',
      key: 'label',
      width: 150,
    },
    {
      title: '基础值 / Base',
      dataIndex: 'base',
      key: 'base',
      width: 120,
      align: 'right',
    },
    {
      title: '强化加成 / Enhance',
      key: 'enhanced',
      width: 120,
      align: 'right',
      render: (_, record) => (
        <span style={{ color: '#52c41a' }}>
          +{record.enhanced - record.base}
        </span>
      ),
    },
    {
      title: '总属性 / Total',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      render: (val) => <strong>{val.toLocaleString()}</strong>,
    },
  ];

  // 属性表格数据
  const statTableData = useMemo(() => {
    if (!selectedCharacter || !currentStats) return [];

    return [
      {
        key: 'atk',
        label: '攻击 / ATK',
        base: selectedCharacter.baseStats.atk,
        enhanced: currentStats.atk,
        total: currentStats.atk,
      },
      {
        key: 'life',
        label: '生命 / HP',
        base: selectedCharacter.baseStats.life,
        enhanced: currentStats.life,
        total: currentStats.life,
      },
      {
        key: 'def',
        label: '物理防御 / DEF',
        base: selectedCharacter.baseStats.def,
        enhanced: currentStats.def,
        total: currentStats.def,
      },
      {
        key: 'mdf',
        label: '魔法防御 / MDF',
        base: selectedCharacter.baseStats.mdf,
        enhanced: currentStats.mdf,
        total: currentStats.mdf,
      },
    ];
  }, [selectedCharacter, currentStats]);

  // 天赋表格列
  const talentColumns: ColumnsType<{ id: number; name: string; level: number; effect: string; active: boolean }> = [
    {
      title: '天赋名 / Talent',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: '开启阶段 / Level',
      dataIndex: 'level',
      key: 'level',
      width: 100,
      align: 'center',
    },
    {
      title: '效果 / Effect',
      dataIndex: 'effect',
      key: 'effect',
      ellipsis: true,
    },
    {
      title: '状态 / Status',
      key: 'active',
      width: 100,
      align: 'center',
      render: (_, record) => (
        record.active
          ? <Tag color="green">已激活</Tag>
          : <Tag color="default">未激活</Tag>
      ),
    },
  ];

  // 天赋表格数据
  const talentTableData = useMemo(() =>
    characterTalents.map(t => ({
      ...t,
      active: t.level <= talentLevel,
    })),
    [characterTalents, talentLevel]
  );

  // 技能表格列
  const skillColumns: ColumnsType<{ id: number; name: string; type: string; description: string }> = [
    {
      title: '技能名 / Skill',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: '类型 / Type',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      align: 'center',
      render: (type) => (
        <Tag color={type === '普攻' ? 'blue' : 'red'}>
          {type}
        </Tag>
      ),
    },
    {
      title: '描述 / Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
  ];

  // 重置属性
  const handleReset = useCallback(() => {
    setTalentLevel(1);
    setEnhanceLevel(0);
    setStarLevel(1);
    message.success('已重置 / Reset complete');
  }, []);

  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>👤</span>
          <div className={styles.headerTitle}>
            <h1>角色养成 / Characters</h1>
            <p>武将培养与属性成长计算</p>
          </div>
        </div>
        <Link href="/simulation-system/economy/overview" className={styles.backButton}>
          返回 / Back
        </Link>
      </header>

      {/* 主内容 */}
      <main className={styles.mainContent}>
        {/* 左侧配置面板 */}
        <div className={styles.configPanel}>
          {/* 武将选择 */}
          <Card className={styles.configCard} title="武将选择 / Character Select">
            <Select
              style={{ width: '100%' }}
              value={selectedCharacterId}
              onChange={setSelectedCharacterId}
              options={characterOptions}
              showSearch
              filterOption={(input, option) =>
                (option?.label as unknown as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />

            {selectedCharacter && (
              <div className={styles.characterInfo}>
                <div className={styles.characterHeader}>
                  <Tag color={CAMP_COLORS[selectedCharacter.camp]}>
                    {selectedCharacter.camp}
                  </Tag>
                  <Tag color={RARITY_CONFIG[selectedCharacter.rarity].color}>
                    {RARITY_CONFIG[selectedCharacter.rarity].label}
                  </Tag>
                </div>
                <div className={styles.characterStats}>
                  <span><HeartOutlined /> 资质: {selectedCharacter.int}</span>
                </div>
              </div>
            )}
          </Card>

          {/* 属性配置 */}
          <Card className={styles.configCard} title="属性配置 / Stat Config">
            {/* 天赋等级 */}
            <div className={styles.sliderItem}>
              <div className={styles.sliderLabel}>
                <span>天赋等级 / Talent Level</span>
                <strong>{talentLevel}</strong>
              </div>
              <Slider
                min={1}
                max={12}
                value={talentLevel}
                onChange={setTalentLevel}
                marks={{ 1: '1', 6: '6', 12: '12' }}
              />
            </div>

            {/* 强化等级 */}
            <div className={styles.sliderItem}>
              <div className={styles.sliderLabel}>
                <span>强化等级 / Enhance Level</span>
                <strong>+{enhanceLevel * 5}%</strong>
              </div>
              <Slider
                min={0}
                max={30}
                value={enhanceLevel}
                onChange={setEnhanceLevel}
                marks={{ 0: '0', 15: '+75%', 30: '+150%' }}
              />
            </div>

            {/* 星级 */}
            <div className={styles.sliderItem}>
              <div className={styles.sliderLabel}>
                <span>星级 / Star Level</span>
                <strong>{starLevel}星</strong>
              </div>
              <Slider
                min={1}
                max={6}
                value={starLevel}
                onChange={setStarLevel}
                marks={{ 1: '1', 3: '3', 6: '6' }}
              />
            </div>

            <Button
              type="default"
              onClick={handleReset}
              block
              style={{ marginTop: 16 }}
            >
              重置 / Reset
            </Button>
          </Card>
        </div>

        {/* 右侧结果面板 */}
        <div className={styles.resultsPanel}>
          {/* 属性总览 */}
          <Card className={styles.resultCard} title="属性总览 / Stats Overview">
            <div className={styles.statsGrid}>
              <div className={styles.statItem}>
                <div className={styles.statIcon}><ThunderboltOutlined /></div>
                <div className={styles.statContent}>
                  <div className={styles.statValue}>{currentStats?.atk.toLocaleString() || 0}</div>
                  <div className={styles.statLabel}>攻击 / ATK</div>
                </div>
              </div>
              <div className={styles.statItem}>
                <div className={styles.statIcon}><HeartOutlined /></div>
                <div className={styles.statContent}>
                  <div className={styles.statValue}>{currentStats?.life.toLocaleString() || 0}</div>
                  <div className={styles.statLabel}>生命 / HP</div>
                </div>
              </div>
              <div className={styles.statItem}>
                <div className={styles.statIcon}><SafetyOutlined /></div>
                <div className={styles.statContent}>
                  <div className={styles.statValue}>{currentStats?.def.toLocaleString() || 0}</div>
                  <div className={styles.statLabel}>物理防御 / DEF</div>
                </div>
              </div>
              <div className={styles.statItem}>
                <div className={styles.statIcon}><ExperimentOutlined /></div>
                <div className={styles.statContent}>
                  <div className={styles.statValue}>{currentStats?.mdf.toLocaleString() || 0}</div>
                  <div className={styles.statLabel}>魔法防御 / MDF</div>
                </div>
              </div>
            </div>

            {/* 属性加成总结 */}
            <div className={styles.bonusSummary}>
              <span className={styles.bonusItem}>
                <Tag color="blue">天赋加成</Tag>
                +{talentLevel - 1}阶段
              </span>
              <span className={styles.bonusItem}>
                <Tag color="green">强化加成</Tag>
                +{enhanceLevel * 5}%
              </span>
              <span className={styles.bonusItem}>
                <Tag color="orange">星级加成</Tag>
                +{(starLevel - 1) * 10}%
              </span>
              <span className={styles.bonusItem}>
                <Tag color="purple">总加成</Tag>
                {((1 + enhanceLevel * 0.05) * (1 + (starLevel - 1) * 0.1) - 1).toFixed(0)}%
              </span>
            </div>
          </Card>

          {/* 属性详情表格 */}
          <Card className={styles.resultCard} title="属性详情 / Stats Detail">
            <Table
              columns={statColumns}
              dataSource={statTableData}
              pagination={false}
              size="small"
              rowKey="key"
            />
          </Card>

          {/* 天赋列表 */}
          <Card className={styles.resultCard} title={`天赋列表 / Talents (${characterTalents.length})`}>
            <Table
              columns={talentColumns}
              dataSource={talentTableData}
              pagination={false}
              size="small"
              rowKey="id"
              rowClassName={(record) => record.active ? styles.talentActive : ''}
            />
          </Card>

          {/* 技能列表 */}
          <Card className={styles.resultCard} title={`技能列表 / Skills (${characterSkills.length})`}>
            <Table
              columns={skillColumns}
              dataSource={characterSkills}
              pagination={false}
              size="small"
              rowKey="id"
            />
          </Card>
        </div>
      </main>
    </div>
  );
}
