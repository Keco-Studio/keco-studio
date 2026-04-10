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
  ThunderboltOutlined,
} from '@ant-design/icons';
import styles from './SimulationSystem.module.css';

/** 经济系统模块配置 */
const ECONOMY_MODULES = [
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
    name: '装备系统 / Equipment',
    nameEn: 'Equipment',
    icon: <ShoppingOutlined />,
    path: '/simulation-system/economy/equipment',
    description: '装备强化、打造、品阶属性',
    color: '#fa8c16',
  },
  {
    id: 'arena',
    name: '竞技场 / Arena',
    nameEn: 'Arena',
    icon: <TrophyOutlined />,
    path: '/simulation-system/economy/arena',
    description: '竞技场对战、排名奖励、声望计算',
    color: '#f5222d',
  },
  {
    id: 'levels',
    name: '关卡系统 / Levels',
    nameEn: 'Levels',
    icon: <BankOutlined />,
    path: '/simulation-system/economy/levels',
    description: '关卡消耗与收益计算',
    color: '#52c41a',
  },
  {
    id: 'prestige',
    name: '忍阶声望 / Prestige',
    nameEn: 'Prestige',
    icon: <StarOutlined />,
    path: '/simulation-system/economy/prestige',
    description: '忍阶晋升、声望积累、每日收益',
    color: '#eb2f96',
  },
  {
    id: 'calculator',
    name: '综合计算器 / Calculator',
    nameEn: 'Calculator',
    icon: <ExperimentOutlined />,
    path: '/simulation-system/economy/calculator',
    description: '综合收益与成长路线规划',
    color: '#13c2c2',
  },
] as const;

/** 战斗模拟模块配置 */
const BATTLE_MODULES = [
  {
    id: 'battle-simulator',
    name: '战斗模拟 / Battle Sim',
    nameEn: 'Battle Simulator',
    icon: <ThunderboltOutlined />,
    path: '/simulation-system/battle',
    description: 'PVE回合制战斗模拟与难度评估',
    color: '#fa541c',
  },
] as const;

/**
 * 模拟系统主页面
 * 整合经济模拟系统和战斗模拟系统的统一入口
 */
export default function SimulationSystemPage() {
  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>🎮</span>
          <div className={styles.headerTitle}>
            <h1>模拟系统</h1>
            <p>Simulation System</p>
          </div>
        </div>
        <Badge status="processing" text="游戏模拟工具" />
        <Link href="/projects" className={styles.backButton}>
          ← 返回/Back
        </Link>
      </header>

      {/* 主内容 */}
      <main className={styles.mainContent}>
        {/* 侧边模块导航 */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTitle}>功能模块</div>
          <nav className={styles.moduleNav}>
            {/* 战斗模拟 */}
            {BATTLE_MODULES.map((module) => (
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
                    <span className={styles.moduleNameCn}>{module.name.split(' / ')[0]}</span>
                    <span className={styles.moduleNameEn}>{module.nameEn}</span>
                  </span>
                </Link>
              </Tooltip>
            ))}

            {/* 经济模拟 */}
            {ECONOMY_MODULES.map((module) => (
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
                    <span className={styles.moduleNameCn}>{module.name.split(' / ')[0]}</span>
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
                🎮
              </span>
              <div className={styles.introTitle}>
                <h2>模拟系统</h2>
                <p>Simulation System</p>
              </div>
            </div>
            <p className={styles.introDesc}>
              基于《少年三国志2》和《火影忍者》手游数据构建的综合模拟系统
            </p>
          </Card>

          {/* 系统分类卡片 */}
          <div className={styles.systemGrid}>
            {/* 战斗模拟 */}
            <Link
              href="/simulation-system/battle"
              className={styles.systemCard}
            >
              <div
                className={styles.systemCardIcon}
                style={{ backgroundColor: '#fa541c' }}
              >
                <ThunderboltOutlined />
              </div>
              <div className={styles.systemCardContent}>
                <div className={styles.systemCardTitle}>
                  战斗模拟
                </div>
                <div className={styles.systemCardDesc}>
                  PVE回合制战斗模拟，支持大规模批量测试，自动计算难度评级
                </div>
              </div>
            </Link>

            {/* 经济模拟 */}
            <Link
              href="/simulation-system/economy/characters"
              className={styles.systemCard}
            >
              <div
                className={styles.systemCardIcon}
                style={{ backgroundColor: '#722ed1' }}
              >
                💰
              </div>
              <div className={styles.systemCardContent}>
                <div className={styles.systemCardTitle}>
                  经济模拟系统
                </div>
                <div className={styles.systemCardDesc}>
                  角色养成、装备系统、竞技场、关卡收益等综合经济计算
                </div>
              </div>
            </Link>
          </div>

          {/* 模块导航卡片 */}
          <div className={styles.moduleGrid}>
            {BATTLE_MODULES.map((module) => (
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
                    {module.name.split(' / ')[0]}
                  </div>
                  <div className={styles.moduleCardDesc}>
                    {module.description}
                  </div>
                </div>
              </Link>
            ))}
            {ECONOMY_MODULES.map((module) => (
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
            <h3 className={styles.infoTitle}>📌 系统说明 / System Info</h3>
            <div className={styles.infoContent}>
              <p>
                本模拟系统基于《少年三国志2》和《火影忍者》手游的实际数据构建，
                用于模拟游戏内的经济循环和战斗系统。
              </p>
              <ul className={styles.infoList}>
                <li><strong>战斗模拟：</strong>PVE回合制战斗模拟，支持批量测试和难度评估</li>
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
