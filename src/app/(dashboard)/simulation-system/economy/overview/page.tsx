'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Card, Badge, Tooltip } from 'antd';
import {
  UserOutlined,
  ShoppingOutlined,
  TrophyOutlined,
  BankOutlined,
  StarOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import styles from './EconomySimulator.module.css';

/** 模块配置 */
const MODULES = [
  {
    id: 'characters',
    name: '角色养成',
    nameEn: 'Characters',
    icon: <UserOutlined />,
    path: '/simulation-system/economy/characters',
    description: '武将培养、属性成长，天赋系统',
    color: '#1890ff',
  },
  {
    id: 'equipment',
    name: '装备系统',
    nameEn: 'Equipment',
    icon: <ShoppingOutlined />,
    path: '/simulation-system/economy/equipment',
    description: '装备强化、打造、品阶属性',
    color: '#fa8c16',
  },
  {
    id: 'arena',
    name: '竞技场',
    nameEn: 'Arena',
    icon: <TrophyOutlined />,
    path: '/simulation-system/economy/arena',
    description: '竞技场对战、排名奖励、声望计算',
    color: '#f5222d',
  },
  {
    id: 'levels',
    name: '关卡系统',
    nameEn: 'Levels',
    icon: <BankOutlined />,
    path: '/simulation-system/economy/levels',
    description: '关卡消耗与收益计算',
    color: '#52c41a',
  },
  {
    id: 'prestige',
    name: '忍阶声望',
    nameEn: 'Prestige',
    icon: <StarOutlined />,
    path: '/simulation-system/economy/prestige',
    description: '忍阶晋升、声望积累、每日收益',
    color: '#eb2f96',
  },
  {
    id: 'calculator',
    name: '综合计算器',
    nameEn: 'Calculator',
    icon: <ExperimentOutlined />,
    path: '/simulation-system/economy/calculator',
    description: '综合收益与成长路线规划',
    color: '#13c2c2',
  },
] as const;

/**
 * 经济模拟系统概览页面
 */
export default function EconomySimulatorPage() {
  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>💰</span>
          <div className={styles.headerTitle}>
            <h1>经济模拟系统</h1>
            <p>Economy Simulator</p>
          </div>
        </div>
        <Badge status="processing" text="实时计算" />
        <Link href="/simulation-system" className={styles.backButton}>
          ← 返回 / Back
        </Link>
      </header>

      {/* 主内容 */}
      <main className={styles.mainContent}>
        {/* 侧边模块导航 */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTitle}>功能模块</div>
          <nav className={styles.moduleNav}>
            {MODULES.map((module) => (
              <Tooltip
                key={module.id}
                title={module.description}
                placement="right"
              >
                <Link
                  href={module.path}
                  className={styles.moduleItem}
                  style={{
                    '--module-color': module.color,
                  } as React.CSSProperties}
                >
                  <span className={styles.moduleIcon}>{module.icon}</span>
                  <span className={styles.moduleText}>
                    <span className={styles.moduleNameCn}>{module.name}</span>
                    <span className={styles.moduleNameEn}>{module.nameEn}</span>
                  </span>
                </Link>
              </Tooltip>
            ))}
          </nav>
        </aside>

        {/* 内容区域 */}
        <section className={styles.content}>
          {/* 系统说明 */}
          <Card className={styles.introCard} variant="borderless">
            <div className={styles.introHeader}>
              <span className={styles.introIcon} style={{ color: '#722ed1' }}>
                💰
              </span>
              <div className={styles.introTitle}>
                <h2>经济模拟系统</h2>
                <p>Economy Simulator</p>
              </div>
            </div>
            <p className={styles.introDesc}>
              基于《少年三国志2》和《火影忍者》手游数据构建的综合经济模拟系统
            </p>
          </Card>

          {/* 快速统计卡片 */}
          <div className={styles.statsGrid}>
            <Card className={styles.statCard}>
              <div className={styles.statValue}>36</div>
              <div className={styles.statLabel}>武将数量 / Characters</div>
            </Card>
            <Card className={styles.statCard}>
              <div className={styles.statValue}>200+</div>
              <div className={styles.statLabel}>装备种类 / Equipment</div>
            </Card>
            <Card className={styles.statCard}>
              <div className={styles.statValue}>50</div>
              <div className={styles.statLabel}>关卡数量 / Levels</div>
            </Card>
            <Card className={styles.statCard}>
              <div className={styles.statValue}>37</div>
              <div className={styles.statLabel}>忍阶等级 / Prestige</div>
            </Card>
          </div>

          {/* 模块导航卡片 */}
          <div className={styles.moduleGrid}>
            {MODULES.map((module) => (
              <Link
                key={module.id}
                href={module.path}
                className={styles.moduleCard}
              >
                <div
                  className={styles.moduleCardIcon}
                  style={{ backgroundColor: module.color }}
                >
                  {module.icon}
                </div>
                <div className={styles.moduleCardContent}>
                  <div className={styles.moduleCardTitle}>
                    {module.name}
                  </div>
                  <div className={styles.moduleCardDesc}>
                    {module.description}
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* 系统说明 */}
          <Card className={styles.infoCard} variant="borderless">
            <h3 className={styles.infoTitle}>📌 系统说明</h3>
            <div className={styles.infoContent}>
              <p>
                本经济模拟系统基于《少年三国志2》和《火影忍者》手游的实际数据构建，
                用于模拟游戏内的经济循环和资源分配。
              </p>
              <ul className={styles.infoList}>
                <li><strong>角色系统：</strong>包含武将的基础属性、资质、稀有度、阵营克制关系</li>
                <li><strong>装备系统：</strong>装备强化、打造、品质提升、属性计算</li>
                <li><strong>竞技场：</strong>根据排名计算每日奖励、声望获取</li>
                <li><strong>关卡系统：</strong>体力消耗与收益的动态计算</li>
                <li><strong>忍阶声望：</strong>忍阶晋升条件、每日扣除、声望奖励</li>
              </ul>
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
}
