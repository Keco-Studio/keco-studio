'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { InputNumber, message } from 'antd';
import type { Combatant, BattleUnit, BattleState, Element, Skill, BattleLogEntry } from './types';
import {
  DEFAULT_PLAYER_STATS,
  DEFAULT_MONSTER_STATS,
  ELEMENT_CONFIG,
  ELEMENT_STRENGTH_CONFIG,
  REACTION_CONFIG,
} from './types';
import { SKILLS, getAllSkills, getSkillsByElement } from './data/skills';
import {
  createInitialBattleState,
  canUseSkill,
  executeSkill,
  processTurnEnd,
  setSkillCooldown,
  reduceCooldowns,
  checkBattleResult,
  addLog,
} from './core/battleLogic';
import styles from './BattleSimulator.module.css';

// ==================== 工具函数 ====================

/** 获取技能的元素类型 */
const getSkillElement = (skill: Skill): Element | 'none' => {
  if (skill.id.startsWith('pugong')) return 'none';
  if (skill.id.startsWith('huo_')) return 'fire';
  if (skill.id.startsWith('shui_')) return 'water';
  if (skill.id.startsWith('lei_')) return 'thunder';
  if (skill.id.startsWith('cao_')) return 'grass';
  if (skill.id.startsWith('bing_')) return 'ice';
  return 'none';
};

/** 格式化回合日志 */
const formatLogEntry = (entry: BattleLogEntry, index: number) => {
  const getClassName = () => {
    switch (entry.type) {
      case 'skill_use':
        return styles.logActor;
      case 'damage':
        return styles.logDamage;
      case 'heal':
        return styles.logHeal;
      case 'mp_cost':
      case 'mp_recover':
        return styles.logMp;
      case 'element_reaction':
        return styles.logReaction;
      default:
        return '';
    }
  };

  return (
    <div key={entry.id || index} className={styles.battleLogLine}>
      <span className={styles.logTurn}>[T{entry.turn}]</span>{' '}
      {entry.actor && <span className={entry.actor === '玩家' ? styles.logActorPlayer : styles.logActorMonster}>{entry.actor}</span>}
      {entry.actor && ' → '}
      {entry.skillName && <span>{entry.skillName}</span>}
      {entry.statusText && (
        <span style={{ color: entry.color || 'inherit' }}> {entry.statusText}</span>
      )}
    </div>
  );
};

// ==================== 主组件 ====================

export default function BattleSimulatorPage() {
  // ==================== 状态定义 ====================

  // 玩家配置
  const [playerConfig, setPlayerConfig] = useState({
    name: DEFAULT_PLAYER_STATS.name,
    hp: DEFAULT_PLAYER_STATS.hp,
    atk: DEFAULT_PLAYER_STATS.atk,
    def: DEFAULT_PLAYER_STATS.def,
    spd: DEFAULT_PLAYER_STATS.spd,
    mp: DEFAULT_PLAYER_STATS.mp,
  });

  // 敌人配置
  const [monsterConfig, setMonsterConfig] = useState({
    name: DEFAULT_MONSTER_STATS.name,
    hp: DEFAULT_MONSTER_STATS.hp,
    atk: DEFAULT_MONSTER_STATS.atk,
    def: DEFAULT_MONSTER_STATS.def,
    spd: DEFAULT_MONSTER_STATS.spd,
    mp: DEFAULT_MONSTER_STATS.mp,
  });

  // 敌人初始元素
  const [monsterInitialElement, setMonsterInitialElement] = useState<Element | null>(null);

  // 战斗状态
  const [battleState, setBattleState] = useState<BattleState | null>(null);

  // 选中的技能
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  // 当前选中的元素标签
  const [selectedElement, setSelectedElement] = useState<string>('all');

  // 玩家配置的技能列表（战前配置，最多6个）
  const [playerSkillIds, setPlayerSkillIds] = useState<string[]>(() => {
    // 默认选择前6个技能
    const allSkills = getAllSkills();
    return allSkills.slice(0, 6).map(s => s.id);
  });

  // 日志滚动引用
  const logRef = useRef<HTMLDivElement>(null);

  // ==================== 计算属性 ====================

  // 获取玩家配置的所有技能
  const playerConfiguredSkills = useMemo(() => {
    const allSkills = getAllSkills();
    return playerSkillIds
      .map(id => allSkills.find(s => s.id === id))
      .filter((s): s is Skill => s !== undefined);
  }, [playerSkillIds]);

  // 当前显示的技能列表（根据战斗状态决定）
  const displayedSkills = useMemo(() => {
    if (!battleState) {
      return selectedElement === 'all' ? getAllSkills() : getSkillsByElement(selectedElement as Element);
    }
    if (battleState.phase === 'setup') {
      return selectedElement === 'all' ? getAllSkills() : getSkillsByElement(selectedElement as Element);
    }
    if (battleState.phase === 'finished') {
      return playerConfiguredSkills;
    }
    return playerConfiguredSkills;
  }, [selectedElement, battleState, playerConfiguredSkills]);

  // 战斗状态下的技能列表（带冷却状态）
  const skillsWithCooldown = useMemo(() => {
    if (!battleState || battleState.phase === 'setup' || battleState.phase === 'finished') {
      return displayedSkills;
    }
    // 战斗中只显示配置好的技能，并添加冷却状态
    return displayedSkills.map(skill => ({
      ...skill,
      currentCooldown: battleState.skillCooldowns[skill.id] || 0,
    }));
  }, [displayedSkills, battleState, selectedElement, playerConfiguredSkills]);

  // ==================== 处理函数 ====================

  // 更新玩家属性
  const updatePlayerStat = useCallback((field: string, value: number | string | null) => {
    setPlayerConfig(prev => ({ ...prev, [field]: value }));
  }, []);

  // 更新敌人属性
  const updateMonsterStat = useCallback((field: string, value: number | string | null) => {
    setMonsterConfig(prev => ({ ...prev, [field]: value }));
  }, []);

  // 开始战斗
  const handleStartBattle = useCallback(() => {
    // 验证配置
    if (!playerConfig.name || !monsterConfig.name) {
      message.warning('请输入角色名称');
      return;
    }

    const player: Combatant = {
      id: 'player',
      name: playerConfig.name,
      hp: playerConfig.hp,
      atk: playerConfig.atk,
      def: playerConfig.def,
      spd: playerConfig.spd,
      mp: playerConfig.mp,
      type: 'player',
    };

    const monster: Combatant = {
      id: 'monster',
      name: monsterConfig.name,
      hp: monsterConfig.hp,
      atk: monsterConfig.atk,
      def: monsterConfig.def,
      spd: monsterConfig.spd,
      mp: monsterConfig.mp,
      type: 'monster',
    };

    const initialState = createInitialBattleState({
      player,
      monster,
      monsterInitialElement: monsterInitialElement || undefined,
      maxTurns: 100,
    });

    initialState.battleLogs.push(addLog(initialState, {
      type: 'battle_start',
      statusText: `📋 战前配置：从下方选择最多 6 个技能，然后点击「确认开战」`,
      color: '#8b949e',
    }));

    setBattleState(initialState);
    setSelectedSkill(null);
  }, [playerConfig, monsterConfig, monsterInitialElement]);

  // 战前配置完成，正式进入第一回合
  const handleConfirmBeginCombat = useCallback(() => {
    if (!battleState || battleState.phase !== 'setup') return;
    if (playerSkillIds.length === 0) {
      message.warning('请至少配置 1 个技能');
      return;
    }
    const base = { ...battleState, currentTurn: 1, phase: 'player_turn' as const };
    let logs = [...battleState.battleLogs];
    logs.push(addLog(base, {
      type: 'battle_start',
      statusText: `⚔️ 战斗开始！`,
      color: '#dcdcaa',
    }));
    logs.push(addLog(base, {
      type: 'battle_start',
      statusText: `速度：玩家 ${base.player.spd} vs ${base.monster.name} ${base.monster.spd}`,
      color: '#8b949e',
    }));
    setBattleState({
      ...base,
      battleLogs: logs,
    });
    setSelectedSkill(null);
  }, [battleState, playerSkillIds.length]);

  // 玩家使用技能
  const handleUseSkill = useCallback(() => {
    if (!battleState || !selectedSkill || battleState.phase !== 'player_turn') return;

    const { player, monster } = battleState;

    // 检查技能是否在配置列表中（战斗中只能使用配置的技能）
    if (!playerSkillIds.includes(selectedSkill.id)) {
      message.warning('只能使用已配置的技能！');
      return;
    }

    // 检查技能是否可用
    const check = canUseSkill(selectedSkill, player, battleState.skillCooldowns);
    if (!check.canUse) {
      message.warning(check.reason);
      return;
    }

    // 检查是否被冻结
    if (player.control?.type === 'freeze') {
      message.warning('你被冻结了，跳过回合！');
      // 跳过回合，进入敌人回合
      handleEnemyTurn({ ...battleState, phase: 'enemy_turn' }, player, monster);
      return;
    }

    let newState = { ...battleState };
    let logs = [...battleState.battleLogs];
    let newPlayer = { ...player };
    let newMonster = { ...monster };

    // 执行技能
    const result = executeSkill(newState, newPlayer, newMonster, selectedSkill, logs);
    newPlayer = result.newAttacker;
    newMonster = result.newDefender;
    logs = result.newLogs;

    // 设置技能冷却
    const newCooldowns = setSkillCooldown(battleState.skillCooldowns, selectedSkill);

    newState = {
      ...newState,
      player: newPlayer,
      monster: newMonster,
      skillCooldowns: newCooldowns,
      battleLogs: logs,
    };

    // 检查战斗结果
    const result2 = checkBattleResult(newPlayer, newMonster);
    if (result2) {
      newState.phase = 'finished';
      newState.result = result2;
      logs.push(addLog(newState, {
        type: 'battle_end',
        statusText: result2 === 'player_win' ? '🎉 玩家获胜！' :
          result2 === 'monster_win' ? '💀 敌人获胜！' : '⚖️ 平局！',
        color: result2 === 'player_win' ? '#51cf66' : result2 === 'monster_win' ? '#ff6b6b' : '#ffd43b',
      }));
      setBattleState(newState);
      return;
    }

    // 进入敌人回合
    newState.phase = 'enemy_turn';
    setBattleState(newState);

    // 延迟执行敌人行动
    setTimeout(() => {
      handleEnemyTurn(newState, newPlayer, newMonster);
    }, 500);
  }, [battleState, selectedSkill, playerSkillIds]);

  // 敌人回合
  const handleEnemyTurn = useCallback((currentState: BattleState, currentPlayer: BattleUnit, currentMonster: BattleUnit) => {
    let newState = { ...currentState };
    let logs = [...currentState.battleLogs];
    let player = { ...currentPlayer };
    let monster = { ...currentMonster };

    // 检查怪物是否被冻结
    if (monster.control?.type === 'freeze') {
      logs.push(addLog(newState, {
        type: 'control',
        actor: monster.name,
        statusText: `${monster.name} 被冻结，跳过回合！`,
        color: '#74c0fc',
      }));

      newState = {
        ...newState,
        battleLogs: logs,
        phase: 'round_end',
      };

      handleRoundEnd(newState, player, monster);
      return;
    }

    // 敌人选择技能（简化逻辑：随机选择一个可用技能）
    const enemySkills = getAllSkills().filter(s => {
      if (s.id.startsWith('pugong')) return true;
      return s.mpCost <= monster.mp;
    });

    // 优先选择有元素反应的技能
    let enemySkill: Skill | null = null;

    for (const skill of enemySkills) {
      if (skill.attachElement && player.element) {
        const skillElem = skill.attachElement.element;
        if (skillElem !== 'random') {
          // 检查是否能触发反应
          if ((skillElem === 'fire' && player.element.element === 'water') ||
            (skillElem === 'fire' && player.element.element === 'ice') ||
            (skillElem === 'water' && player.element.element === 'fire') ||
            (skillElem === 'thunder' && player.element.element === 'water') ||
            (skillElem === 'grass' && player.element.element === 'fire')) {
            enemySkill = skill;
            break;
          }
        }
      }
    }

    if (!enemySkill) {
      // 随机选择
      enemySkill = enemySkills[Math.floor(Math.random() * Math.min(3, enemySkills.length))];
    }

    if (enemySkill) {
      const result = executeSkill(newState, monster, player, enemySkill, logs);
      player = result.newDefender;
      monster = result.newAttacker;
      logs = result.newLogs;

      // 设置敌人技能冷却
      const newCooldowns = setSkillCooldown(newState.skillCooldowns, enemySkill);
      newState.skillCooldowns = newCooldowns;
    }

    newState.player = player;
    newState.monster = monster;
    newState.battleLogs = logs;

    // 检查战斗结果
    const battleResult = checkBattleResult(player, monster);
    if (battleResult) {
      newState.phase = 'finished';
      newState.result = battleResult;
      logs.push(addLog(newState, {
        type: 'battle_end',
        statusText: battleResult === 'player_win' ? '🎉 玩家获胜！' :
          battleResult === 'monster_win' ? '💀 敌人获胜！' : '⚖️ 平局！',
        color: battleResult === 'player_win' ? '#51cf66' : battleResult === 'monster_win' ? '#ff6b6b' : '#ffd43b',
      }));
      setBattleState(newState);
      return;
    }

    // 进入回合结束
    newState.phase = 'round_end';
    setBattleState(newState);

    // 延迟进入回合结束处理
    setTimeout(() => {
      handleRoundEnd(newState, player, monster);
    }, 500);
  }, []);

  // 回合结束处理
  const handleRoundEnd = useCallback((currentState: BattleState, currentPlayer: BattleUnit, currentMonster: BattleUnit) => {
    let newState = { ...currentState };
    let logs = [...currentState.battleLogs];
    let player = { ...currentPlayer };
    let monster = { ...currentMonster };

    logs.push(addLog(newState, {
      type: 'turn_end',
      statusText: '─'.repeat(30),
      color: '#6e7681',
    }));

    // 处理玩家回合结束
    const playerResult = processTurnEnd(newState, player, logs);
    player = playerResult.newUnit;
    logs = playerResult.newLogs;

    // 处理怪物回合结束
    const monsterResult = processTurnEnd(newState, monster, logs);
    monster = monsterResult.newUnit;
    logs = monsterResult.newLogs;

    // 减少冷却
    const newCooldowns = reduceCooldowns(newState.skillCooldowns);

    // 检查战斗结果
    const battleResult = checkBattleResult(player, monster);
    if (battleResult) {
      newState = {
        ...newState,
        player,
        monster,
        battleLogs: logs,
        skillCooldowns: newCooldowns,
        phase: 'finished',
        result: battleResult,
      };
      logs.push(addLog(newState, {
        type: 'battle_end',
        statusText: battleResult === 'player_win' ? '🎉 玩家获胜！' :
          battleResult === 'monster_win' ? '💀 敌人获胜！' : '⚖️ 平局！',
        color: battleResult === 'player_win' ? '#51cf66' : battleResult === 'monster_win' ? '#ff6b6b' : '#ffd43b',
      }));
      setBattleState(newState);
      return;
    }

    // 新回合开始
    const newTurn = newState.currentTurn + 1;
    logs.push(addLog(newState, {
      type: 'turn_start',
      statusText: `回合 ${newTurn} 开始`,
      color: '#569cd6',
    }));

    newState = {
      ...newState,
      player,
      monster,
      battleLogs: logs,
      skillCooldowns: newCooldowns,
      currentTurn: newTurn,
      phase: 'player_turn',
    };

    setBattleState(newState);
  }, []);

  // 重置战斗
  const handleReset = useCallback(() => {
    setBattleState(null);
    setSelectedSkill(null);
    setMonsterInitialElement(null);
  }, []);

  // ==================== 渲染 ====================

  // 渲染属性面板
  const renderConfigPanel = () => (
    <div className={styles.configPanel}>
      {/* 玩家属性 */}
      <div className={`${styles.configCard} ${styles.playerCard} ${battleState && battleState.phase !== 'setup' ? styles.inCombat : ''}`}>
        <div className={styles.configCardTitle}>
          <span className={styles.playerIcon}>👤</span>
          玩家属性
        </div>
        <div className={styles.statsGrid}>
          <div className={`${styles.statItem} ${styles.statItemFull}`}>
            <span className={styles.statLabel}>名字</span>
            <input
              type="text"
              className={styles.nameInput}
              value={playerConfig.name}
              onChange={(e) => updatePlayerStat('name', e.target.value)}
              disabled={battleState !== null}
              maxLength={20}
            />
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>HP</span>
            <InputNumber
              className={styles.statInput}
              min={1}
              max={99999}
              value={playerConfig.hp}
              onChange={(v) => updatePlayerStat('hp', v)}
              disabled={battleState !== null}
            />
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>ATK</span>
            <InputNumber
              className={styles.statInput}
              min={1}
              max={9999}
              value={playerConfig.atk}
              onChange={(v) => updatePlayerStat('atk', v)}
              disabled={battleState !== null}
            />
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>DEF</span>
            <InputNumber
              className={styles.statInput}
              min={0}
              max={9999}
              value={playerConfig.def}
              onChange={(v) => updatePlayerStat('def', v)}
              disabled={battleState !== null}
            />
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>SPD</span>
            <InputNumber
              className={styles.statInput}
              min={1}
              max={9999}
              value={playerConfig.spd}
              onChange={(v) => updatePlayerStat('spd', v)}
              disabled={battleState !== null}
            />
          </div>
          <div className={styles.mpSection}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>MP</span>
              <InputNumber
                className={styles.statInput}
                min={1}
                max={999}
                value={playerConfig.mp}
                onChange={(v) => updatePlayerStat('mp', v)}
                disabled={battleState !== null}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 敌人属性 */}
      <div className={`${styles.configCard} ${styles.monsterCard} ${battleState && battleState.phase !== 'setup' ? styles.inCombat : ''}`}>
        <div className={styles.configCardTitle}>
          <span className={styles.monsterIcon}>💀</span>
          敌人属性
        </div>
        <div className={styles.statsGrid}>
          <div className={`${styles.statItem} ${styles.statItemFull}`}>
            <span className={styles.statLabel}>名字</span>
            <input
              type="text"
              className={styles.nameInput}
              value={monsterConfig.name}
              onChange={(e) => updateMonsterStat('name', e.target.value)}
              disabled={battleState !== null}
              maxLength={20}
            />
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>HP</span>
            <InputNumber
              className={styles.statInput}
              min={1}
              max={99999}
              value={monsterConfig.hp}
              onChange={(v) => updateMonsterStat('hp', v)}
              disabled={battleState !== null}
            />
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>ATK</span>
            <InputNumber
              className={styles.statInput}
              min={1}
              max={9999}
              value={monsterConfig.atk}
              onChange={(v) => updateMonsterStat('atk', v)}
              disabled={battleState !== null}
            />
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>DEF</span>
            <InputNumber
              className={styles.statInput}
              min={0}
              max={9999}
              value={monsterConfig.def}
              onChange={(v) => updateMonsterStat('def', v)}
              disabled={battleState !== null}
            />
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>SPD</span>
            <InputNumber
              className={styles.statInput}
              min={1}
              max={9999}
              value={monsterConfig.spd}
              onChange={(v) => updateMonsterStat('spd', v)}
              disabled={battleState !== null}
            />
          </div>
          <div className={styles.mpSection}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>MP</span>
              <InputNumber
                className={styles.statInput}
                min={1}
                max={999}
                value={monsterConfig.mp}
                onChange={(v) => updateMonsterStat('mp', v)}
                disabled={battleState !== null}
              />
            </div>
          </div>
        </div>

        {/* 敌人初始元素预设 */}
        <div className={styles.elementPreset}>
          <div className={styles.elementPresetTitle}>敌人初始元素</div>
          <div className={styles.elementButtons}>
            <button
              className={`${styles.elementButton} ${monsterInitialElement === null ? styles.elementButtonActive : ''}`}
              onClick={() => setMonsterInitialElement(null)}
              disabled={battleState !== null}
            >
              无
            </button>
            {(['fire', 'water', 'thunder', 'grass', 'ice'] as Element[]).map((elem) => (
              <button
                key={elem}
                className={`${styles.elementButton} ${monsterInitialElement === elem ? styles.elementButtonActive : ''}`}
                onClick={() => setMonsterInitialElement(elem)}
                disabled={battleState !== null}
                style={{ color: monsterInitialElement === elem ? ELEMENT_CONFIG[elem].color : undefined }}
              >
                {ELEMENT_CONFIG[elem].emoji} {ELEMENT_CONFIG[elem].name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className={styles.actionButtons}>
        {battleState === null ? (
          <button className={styles.startButton} onClick={handleStartBattle}>
            ⚔️ 开始战斗
          </button>
        ) : battleState.phase === 'finished' ? (
          <button className={styles.startButton} onClick={handleReset}>
            🔄 重新开始
          </button>
        ) : battleState.phase === 'setup' ? (
          <>
            <button
              className={styles.startButton}
              onClick={handleConfirmBeginCombat}
              disabled={playerSkillIds.length === 0}
            >
              ✅ 确认开战
            </button>
            <button className={styles.resetButton} onClick={handleReset}>
              取消
            </button>
          </>
        ) : (
          <>
            <button
              className={styles.executeButton}
              onClick={handleUseSkill}
              disabled={!selectedSkill}
            >
              🎯 使用技能
            </button>
            <button className={styles.resetButton} onClick={handleReset}>
              重置
            </button>
          </>
        )}
      </div>
    </div>
  );

  // 渲染战斗舞台
  const renderBattleStage = () => {
    if (!battleState) {
      return (
        <div className={styles.battleStage}>
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>⚔️</div>
            <div className={styles.emptyStateTitle}>准备战斗</div>
            <div className={styles.emptyStateDesc}>
              设置角色属性后，点击「开始战斗」
            </div>
          </div>
        </div>
      );
    }

    if (battleState.phase === 'finished') {
      return (
        <div className={styles.battleStage}>
          <div className={styles.battleResult}>
            <div className={styles.resultIcon}>
              {battleState.result === 'player_win' ? '🎉' :
                battleState.result === 'monster_win' ? '💀' : '⚖️'}
            </div>
            <div className={`${styles.resultTitle} ${battleState.result === 'player_win' ? styles.resultPlayerWin :
                battleState.result === 'monster_win' ? styles.resultMonsterWin :
                  styles.resultDraw
              }`}>
              {battleState.result === 'player_win' ? '玩家获胜！' :
                battleState.result === 'monster_win' ? '敌人获胜！' : '平局！'}
            </div>
            <div className={styles.resultStats}>
              回合数: {battleState.currentTurn} |
              玩家HP: {battleState.player.hp}/{battleState.player.maxHp} |
              敌人HP: {battleState.monster.hp}/{battleState.monster.maxHp}
            </div>
            <div className={styles.actionButtons} style={{ marginTop: 24 }}>
              <button className={styles.startButton} onClick={handleReset}>
                🔄 重新开始
              </button>
            </div>
          </div>
        </div>
      );
    }

    const { player, monster } = battleState;

    return (
      <div className={styles.battleStage}>
        {/* 玩家状态 */}
        <div className={styles.combatantStatus}>
          <div className={styles.statusHeader}>
            <div className={styles.statusName}>
              <span>👤</span>
              <span>{player.name}</span>
              {battleState.phase === 'player_turn' && <span style={{ color: '#51cf66', fontSize: 12 }}>← 行动中</span>}
            </div>
            <div className={styles.statusTurn}>
              {battleState.phase === 'setup' ? '战前配置' : `回合 ${battleState.currentTurn}`}
            </div>
          </div>
          <div className={styles.progressBars}>
            <div className={styles.progressItem}>
              <span className={styles.progressLabel}>HP</span>
              <div className={styles.progressBar}>
                <div
                  className={`${styles.progressFill} ${player.hp / player.maxHp < 0.3 ? styles.hpFillLow : styles.hpFill}`}
                  style={{ width: `${(player.hp / player.maxHp) * 100}%` }}
                />
              </div>
              <span className={styles.progressValue}>{player.hp}/{player.maxHp}</span>
            </div>
            <div className={styles.progressItem}>
              <span className={styles.progressLabel}>MP</span>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${(player.mp / player.maxMp) * 100}%`, background: 'linear-gradient(90deg, #845ef7 0%, #9d7dea 100%)' }}
                />
              </div>
              <span className={styles.progressValue}>{player.mp}/{player.maxMp}</span>
            </div>
          </div>
          <div className={styles.statusTags}>
            {player.element && (
              <span
                className={`${styles.statusTag} ${styles.elementTag}`}
                style={{ color: ELEMENT_CONFIG[player.element.element].color }}
              >
                {ELEMENT_CONFIG[player.element.element].emoji}
                {ELEMENT_CONFIG[player.element.element].name}·
                {ELEMENT_STRENGTH_CONFIG[player.element.strength].name}
                ({player.element.remainingTurns})
              </span>
            )}
            {player.dot && (
              <span className={`${styles.statusTag} ${styles.dotTag}`}>
                🔥灼烧 {Math.ceil(player.atk * player.dot.damage)}/回合({player.dot.remainingTurns})
              </span>
            )}
            {player.control?.type === 'freeze' && (
              <span className={`${styles.statusTag} ${styles.freezeTag}`}>
                ❄️冻结
              </span>
            )}
            {player.buffs.map((buff, i) => (
              <span key={i} className={`${styles.statusTag} ${styles.buffTag}`}>
                {buff.type === 'atk_debuff' && `ATK-${Math.round(buff.value * 100)}%(${buff.remainingTurns})`}
                {buff.type === 'def_debuff' && `DEF-${Math.round(buff.value * 100)}%(${buff.remainingTurns})`}
                {buff.type === 'quicken' && `✨激化+${Math.round(buff.value * 100)}%(${buff.remainingTurns})`}
              </span>
            ))}
          </div>
        </div>

        {/* VS 分隔 */}
        <div className={styles.vsDivider}>
          <span className={styles.vsText}>VS</span>
        </div>

        {/* 敌人状态 */}
        <div className={styles.combatantStatus}>
          <div className={styles.statusHeader}>
            <div className={styles.statusName}>
              <span>💀</span>
              <span>{monster.name}</span>
              {battleState.phase === 'enemy_turn' && <span style={{ color: '#ff6b6b', fontSize: 12 }}>← 行动中</span>}
            </div>
          </div>
          <div className={styles.progressBars}>
            <div className={styles.progressItem}>
              <span className={styles.progressLabel}>HP</span>
              <div className={styles.progressBar}>
                <div
                  className={`${styles.progressFill} ${monster.hp / monster.maxHp < 0.3 ? styles.hpFillLow : styles.hpFill}`}
                  style={{ width: `${(monster.hp / monster.maxHp) * 100}%` }}
                />
              </div>
              <span className={styles.progressValue}>{monster.hp}/{monster.maxHp}</span>
            </div>
            <div className={styles.progressItem}>
              <span className={styles.progressLabel}>MP</span>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${(monster.mp / monster.maxMp) * 100}%`, background: 'linear-gradient(90deg, #845ef7 0%, #9d7dea 100%)' }}
                />
              </div>
              <span className={styles.progressValue}>{monster.mp}/{monster.maxMp}</span>
            </div>
          </div>
          <div className={styles.statusTags}>
            {monster.element && (
              <span
                className={`${styles.statusTag} ${styles.elementTag}`}
                style={{ color: ELEMENT_CONFIG[monster.element.element].color }}
              >
                {ELEMENT_CONFIG[monster.element.element].emoji}
                {ELEMENT_CONFIG[monster.element.element].name}·
                {ELEMENT_STRENGTH_CONFIG[monster.element.strength].name}
                ({monster.element.remainingTurns})
              </span>
            )}
            {monster.dot && (
              <span className={`${styles.statusTag} ${styles.dotTag}`}>
                🔥灼烧 {Math.ceil(monster.atk * monster.dot.damage)}/回合({monster.dot.remainingTurns})
              </span>
            )}
            {monster.control?.type === 'freeze' && (
              <span className={`${styles.statusTag} ${styles.freezeTag}`}>
                ❄️冻结
              </span>
            )}
            {monster.buffs.map((buff, i) => (
              <span key={i} className={`${styles.statusTag} ${buff.type.includes('debuff') ? styles.debuffTag : styles.buffTag}`}>
                {buff.type === 'atk_debuff' && `ATK-${Math.round(buff.value * 100)}%(${buff.remainingTurns})`}
                {buff.type === 'def_debuff' && `DEF-${Math.round(buff.value * 100)}%(${buff.remainingTurns})`}
                {buff.type === 'quicken' && `✨激化+${Math.round(buff.value * 100)}%(${buff.remainingTurns})`}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // 渲染技能选择器
  const renderSkillSelector = () => {
    // 战斗结束时不显示
    if (!battleState || battleState.phase === 'finished') {
      return null;
    }

    const { player, skillCooldowns } = battleState;
    const isSetup = battleState.phase === 'setup';

    return (
      <div className={styles.skillSelector}>
        <div className={styles.skillSelectorTitle}>
          {isSetup ? '⚙️ 配置技能（最多6个）' : '🎯 选择技能'}
        </div>

        {/* 战前配置模式：显示已配置的技能和技能库 */}
        {isSetup && (
          <>
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#1e1e1e', borderRadius: 6, fontSize: 12 }}>
              <span style={{ color: '#8b949e' }}>已配置: </span>
              <span style={{ color: playerSkillIds.length >= 6 ? '#f0883e' : '#50fa7b' }}>
                {playerSkillIds.length}/6
              </span>
              {playerSkillIds.length >= 6 && (
                <span style={{ color: '#f0883e', marginLeft: 8 }}>已达上限</span>
              )}
            </div>
            {/* 已配置技能列表 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {playerConfiguredSkills.map((skill) => {
                const skillElement = getSkillElement(skill);
                const elementColor = skillElement !== 'none' ? ELEMENT_CONFIG[skillElement as Element]?.color : undefined;
                return (
                  <div
                    key={skill.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 8px',
                      background: elementColor ? `${elementColor}20` : '#2d2d2d',
                      border: `1px solid ${elementColor || '#555'}`,
                      borderRadius: 4,
                      fontSize: 12,
                      color: elementColor || '#fff',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setPlayerSkillIds(prev => prev.filter(id => id !== skill.id));
                    }}
                    title="点击移除"
                  >
                    {skillElement !== 'none' && ELEMENT_CONFIG[skillElement as Element]?.emoji}
                    {skill.name}
                    <span style={{ color: '#888', marginLeft: 4 }}>×</span>
                  </div>
                );
              })}
              {playerConfiguredSkills.length === 0 && (
                <div style={{ color: '#666', fontSize: 12 }}>从下方选择技能添加...</div>
              )}
            </div>
            <div style={{ marginBottom: 12, fontSize: 12, color: '#8b949e' }}>
              点击下方技能卡片添加，最多6个
            </div>
          </>
        )}

        {/* 元素标签 */}
        <div className={styles.elementTabs}>
          <button
            className={`${styles.elementTab} ${selectedElement === 'all' ? styles.elementTabActive : ''}`}
            onClick={() => setSelectedElement('all')}
          >
            全部
          </button>
          <button
            className={`${styles.elementTab} ${selectedElement === 'none' ? styles.elementTabActive : ''}`}
            onClick={() => setSelectedElement('none')}
          >
            ⚔️ 普攻
          </button>
          {(['fire', 'water', 'thunder', 'grass', 'ice'] as Element[]).map((elem) => (
            <button
              key={elem}
              className={`${styles.elementTab} ${styles[`elementTab${elem.charAt(0).toUpperCase() + elem.slice(1)}`]} ${selectedElement === elem ? styles.elementTabActive : ''}`}
              onClick={() => setSelectedElement(elem)}
            >
              {ELEMENT_CONFIG[elem].emoji}
            </button>
          ))}
        </div>

        {/* 技能网格 */}
        <div className={styles.skillGrid}>
          {skillsWithCooldown.map((skill) => {
            const cooldown = skillCooldowns[skill.id] || 0;
            const canUse = canUseSkill(skill, player, skillCooldowns);
            const isSelected = selectedSkill?.id === skill.id;
            const skillElement = getSkillElement(skill);
            const elementColor = skillElement !== 'none' ? ELEMENT_CONFIG[skillElement as Element]?.color : undefined;

            return (
              <div
                key={skill.id}
                className={`
                  ${styles.skillCard}
                  ${isSelected ? styles.skillCardSelected : ''}
                  ${!isSetup && !canUse.canUse && cooldown === 0 ? styles.skillCardDisabled : ''}
                  ${cooldown > 0 ? styles.skillCardCooldown : ''}
                `}
                onClick={() => {
                  if (isSetup) {
                    // 战前配置模式：添加技能到配置列表
                    if (playerSkillIds.length < 6 && !playerSkillIds.includes(skill.id)) {
                      setPlayerSkillIds(prev => [...prev, skill.id]);
                    }
                  } else {
                    // 战斗模式：使用技能
                    if (canUse.canUse) {
                      setSelectedSkill(skill);
                    }
                  }
                }}
              >
                <div className={styles.skillCardHeader}>
                  <span className={styles.skillName} style={{ color: elementColor }}>
                    {skillElement !== 'none' && ELEMENT_CONFIG[skillElement as Element]?.emoji}
                    {skill.name}
                  </span>
                  <span className={styles.skillMp}>
                    ⚡{skill.mpCost}
                  </span>
                </div>
                <div className={styles.skillCardStats}>
                  <span className={styles.skillDamage}>{skill.power}×ATK</span>
                  {skill.maxCooldown > 0 && (
                    <span className={styles.skillCooldown}>
                      CD: {cooldown > 0 ? `⏳${cooldown}` : skill.maxCooldown}
                    </span>
                  )}
                </div>
                {skill.attachElement && skill.attachElement.element !== 'random' && (
                  <div className={styles.skillElement} style={{ color: elementColor }}>
                    附加: {ELEMENT_CONFIG[skill.attachElement.element].emoji}
                    {ELEMENT_CONFIG[skill.attachElement.element].name}·
                    {ELEMENT_STRENGTH_CONFIG[skill.attachElement.strength].name}
                  </div>
                )}
                {skill.reactionTrigger && skill.reactionTrigger.length > 0 && (
                  <div className={styles.skillReaction}>
                    {skill.reactionTrigger.map((rt, i) => (
                      <span key={i}>
                        目标有{ELEMENT_CONFIG[rt.element].emoji}→{REACTION_CONFIG[rt.reaction].emoji}{REACTION_CONFIG[rt.reaction].name}
                      </span>
                    ))}
                  </div>
                )}
                {!isSetup && !canUse.canUse && cooldown === 0 && (
                  <div style={{ color: '#ff8787', fontSize: 11, marginTop: 4 }}>
                    {canUse.reason}
                  </div>
                )}
                {cooldown > 0 && (
                  <div style={{ color: '#ffd43b', fontSize: 11, marginTop: 4 }}>
                    ⏳ 冷却中（{cooldown}回合）
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 渲染战斗日志
  const renderBattleLog = () => {
    if (!battleState) {
      return null;
    }

    return (
      <div className={styles.battleLog}>
        <div className={styles.battleLogHeader}>
          <span className={styles.battleLogTitle}>📜 战斗日志</span>
        </div>
        <div className={styles.battleLogContent} ref={logRef}>
          {battleState.battleLogs.map((entry, index) => formatLogEntry(entry, index))}
        </div>
      </div>
    );
  };

  // 自动滚动日志
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [battleState?.battleLogs.length]);

  // ==================== 主渲染 ====================

  return (
    <div className={styles.container}>
      {/* 头部 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>⚔️</span>
          <div className={styles.headerTitle}>
            <h1>战斗模拟器 v2.0</h1>
            <p>元素反应 · 确定性战斗 · 策略对决</p>
          </div>
        </div>
        <Link href="/simulation-system" className={styles.backButton}>
          ← 返回 / Back
        </Link>
      </header>

      {/* 主内容 */}
      <main className={styles.mainContent}>
        {renderConfigPanel()}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {renderBattleStage()}
          {renderSkillSelector()}
          {renderBattleLog()}
        </div>
      </main>
    </div>
  );
}
