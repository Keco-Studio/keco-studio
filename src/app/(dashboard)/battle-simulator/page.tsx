'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Button, InputNumber, Select, Progress, Card, message } from 'antd';
import {
  ThunderboltOutlined,
  UserOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
// 使用 SVG 图标代替 Ant Design Icons
const SkullIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12c0 3.69 2.47 6.86 6 8.25V22h8v-1.75c3.53-1.39 6-4.56 6-8.25 0-5.52-4.48-10-10-10zm-2 15h-1v-2h1v2zm1-4H9V9h2v4zm4 4h-1v-2h1v2zm1-4h-2V9h2v4z"/>
  </svg>
);
const UploadIcon = ({ style }: { style?: React.CSSProperties }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" style={style}>
    <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
  </svg>
);
import type { Combatant, BattleResult, BattleStats } from './types';
import { DEFAULT_PLAYER_STATS, DEFAULT_MONSTER_STATS, BATTLE_FIELDS, DIFFICULTY_CONFIG } from './types';
import { simulateBattle, calculateDifficulty } from './core/battleEngine';
import styles from './BattleSimulator.module.css';

export default function BattleSimulatorPage() {
  // Player config (null means empty)
  const [playerConfig, setPlayerConfig] = useState<Omit<Combatant, 'id' | 'type'> & { hp: number | null; atk: number | null; def: number | null; spd: number | null }>({
    name: DEFAULT_PLAYER_STATS.name,
    hp: DEFAULT_PLAYER_STATS.hp,
    atk: DEFAULT_PLAYER_STATS.atk,
    def: DEFAULT_PLAYER_STATS.def,
    spd: DEFAULT_PLAYER_STATS.spd,
  });

  // Monster config (null means empty)
  const [monsterConfig, setMonsterConfig] = useState<Omit<Combatant, 'id' | 'type'> & { hp: number | null; atk: number | null; def: number | null; spd: number | null }>({
    name: DEFAULT_MONSTER_STATS.name,
    hp: DEFAULT_MONSTER_STATS.hp,
    atk: DEFAULT_MONSTER_STATS.atk,
    def: DEFAULT_MONSTER_STATS.def,
    spd: DEFAULT_MONSTER_STATS.spd,
  });

  // Single battle result
  const [singleBattleResult, setSingleBattleResult] = useState<BattleResult | null>(null);

  // Batch stats result
  const [batchStats, setBatchStats] = useState<BattleStats | null>(null);

  // Batch simulation running
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Simulation runs
  const [simRuns, setSimRuns] = useState(10);

  // Web Worker ref
  const workerRef = useRef<Worker | null>(null);

  // Cleanup Worker
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Imported monsters list (from Library)
  const [importedMonsters, setImportedMonsters] = useState<Array<Omit<Combatant, 'id' | 'type'>>>([]);

  // Update player stat
  const updatePlayerStat = useCallback((field: keyof Omit<Combatant, 'id' | 'type' | 'type'>, value: number | string | null) => {
    setPlayerConfig(prev => ({ ...prev, [field]: value }));
  }, []);

  // Update monster stat
  const updateMonsterStat = useCallback((field: keyof Omit<Combatant, 'id' | 'type' | 'type'>, value: number | string | null) => {
    setMonsterConfig(prev => ({ ...prev, [field]: value }));
  }, []);

  // Validate config completeness
  const validateConfig = (config: typeof playerConfig, type: 'Player' | 'Monster'): boolean => {
    const requiredFields: (keyof typeof config)[] = ['hp', 'atk', 'def', 'spd'];
    for (const field of requiredFields) {
      if (config[field] === null || config[field] === undefined || config[field] === '') {
        message.warning(`${type}'s ${field.toUpperCase()} is required`);
        return false;
      }
    }
    if (!config.name || config.name.trim() === '') {
      message.warning(`${type}'s name is required`);
      return false;
    }
    return true;
  };

  // Run single battle
  const handleSingleBattle = useCallback(() => {
    if (!validateConfig(playerConfig, 'Player') || !validateConfig(monsterConfig, 'Monster')) {
      return;
    }
    const result = simulateBattle({
      player: { ...playerConfig, id: 'player', type: 'player' },
      monster: { ...monsterConfig, id: 'monster', type: 'monster' },
      maxTurns: 100,
    });
    setSingleBattleResult(result);
  }, [playerConfig, monsterConfig]);

  // Stop batch simulation
  const handleStopSimulation = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setIsRunning(false);
  }, []);

  // Run batch simulation (using Web Worker)
  const handleBatchSimulation = useCallback(() => {
    // Validate config
    if (!validateConfig(playerConfig, 'Player') || !validateConfig(monsterConfig, 'Monster')) {
      return;
    }

    // Check if runs count is valid
    if (!simRuns || simRuns <= 0) {
      message.warning('Please enter the number of simulation runs');
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setCompletedCount(0);

    // If imported monsters exist, use them
    const monsters = importedMonsters.length > 0
      ? importedMonsters
      : [monsterConfig];
    const runs = importedMonsters.length > 0 ? 1 : simRuns;
    const total = monsters.length * runs;
    setTotalCount(total);

    // Terminate previous Worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    // Create new Worker using webpack bundling
    const worker = new Worker(
      new URL('./core/battleWorker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, progress, stats, completed, total, result, error } = e.data;

      if (type === 'progress') {
        // Incremental update of progress and stats
        setProgress(progress);
        setCompletedCount(completed);
        setBatchStats(stats);
      } else if (type === 'complete') {
        // Simulation complete
        setProgress(100);
        setCompletedCount(total);
        setBatchStats(result);
        setIsRunning(false);
        worker.terminate();
        workerRef.current = null;
      } else if (type === 'error') {
        console.error('Worker error:', error);
        setIsRunning(false);
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onerror = (error) => {
      console.error('Worker error:', error);
      setIsRunning(false);
    };

    // Start simulation
    worker.postMessage({
      type: 'start',
      playerConfig,
      monsters,
      runsPerMonster: runs,
      batchSize: Math.max(10, Math.min(50, Math.floor(total / 20))),
    });
  }, [playerConfig, monsterConfig, simRuns, importedMonsters]);

  // Calculate current single battle difficulty
  const currentDifficulty = useMemo(() => {
    if (!singleBattleResult) return null;
    return calculateDifficulty(singleBattleResult.playerFinalHp, singleBattleResult.playerStartingHp);
  }, [singleBattleResult]);

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <span className={styles.headerIcon}>⚔️</span>
          Battle Simulator
        </div>
      </header>

      {/* Main Content */}
      <main className={styles.mainContent}>
        {/* Config Panel */}
        <div className={styles.configPanel}>
          {/* Player Config */}
          <Card className={styles.configCard}>
            <div className={styles.configCardTitle}>
              <UserOutlined className={styles.playerIcon} />
              Player Stats
            </div>
            <div className={styles.statsGrid}>
              <div className={`${styles.statItem} ${styles.statItemFull}`}>
                <span className={styles.statLabel}>Name</span>
                <input
                  type="text"
                  className={styles.nameInput}
                  value={playerConfig.name}
                  onChange={(e) => updatePlayerStat('name', e.target.value)}
                  maxLength={50}
                />
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>HP</span>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={99999}
                  value={playerConfig.hp}
                  onChange={(v) => updatePlayerStat('hp', v)}
                  placeholder="Required"
                />
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>ATK</span>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={9999}
                  value={playerConfig.atk}
                  onChange={(v) => updatePlayerStat('atk', v)}
                  placeholder="Required"
                />
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>DEF</span>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={9999}
                  value={playerConfig.def}
                  onChange={(v) => updatePlayerStat('def', v)}
                  placeholder="Required"
                />
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>SPD</span>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={9999}
                  value={playerConfig.spd}
                  onChange={(v) => updatePlayerStat('spd', v)}
                  placeholder="Required"
                />
              </div>
            </div>
          </Card>

          {/* Monster Config */}
          <Card className={styles.configCard}>
            <div className={styles.configCardTitle}>
              <SkullIcon />
              Monster Stats
            </div>
            <div className={styles.statsGrid}>
              <div className={`${styles.statItem} ${styles.statItemFull}`}>
                <span className={styles.statLabel}>Name</span>
                <input
                  type="text"
                  className={styles.nameInput}
                  value={monsterConfig.name}
                  onChange={(e) => updateMonsterStat('name', e.target.value)}
                  maxLength={50}
                />
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>HP</span>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={99999}
                  value={monsterConfig.hp}
                  onChange={(v) => updateMonsterStat('hp', v)}
                  placeholder="Required"
                />
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>ATK</span>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={9999}
                  value={monsterConfig.atk}
                  onChange={(v) => updateMonsterStat('atk', v)}
                  placeholder="Required"
                />
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>DEF</span>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={9999}
                  value={monsterConfig.def}
                  onChange={(v) => updateMonsterStat('def', v)}
                  placeholder="Required"
                />
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>SPD</span>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={9999}
                  value={monsterConfig.spd}
                  onChange={(v) => updateMonsterStat('spd', v)}
                  placeholder="Required"
                />
              </div>
            </div>

            {/* Import section (reserved) */}
            {importedMonsters.length === 0 && (
              <div className={styles.importSection}>
                <div className={styles.importTitle}>
                  <UploadIcon style={{ marginRight: 6 }} />
                  Import from Table (Reserved)
                </div>
                <Select
                  style={{ width: '100%' }}
                  placeholder="Select Library..."
                  options={[]}
                  disabled
                />
              </div>
            )}

            {/* Imported monsters preview */}
            {importedMonsters.length > 0 && (
              <div className={styles.importSection}>
                <div className={styles.importTitle}>
                  Imported {importedMonsters.length} monsters
                </div>
                <div className={styles.monstersPreview}>
                  {importedMonsters.slice(0, 5).map((m, i) => (
                    <div key={i} className={styles.monsterPreviewItem}>
                      {m.name}: HP={m.hp} ATK={m.atk} DEF={m.def} SPD={m.spd}
                    </div>
                  ))}
                  {importedMonsters.length > 5 && (
                    <div className={styles.monsterPreviewItem}>
                      ... and {importedMonsters.length - 5} more
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Action Buttons */}
          <div className={styles.actionButtons}>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              className={styles.actionButton}
              onClick={handleSingleBattle}
              block
            >
              Single Battle
            </Button>
            <div className={styles.batchControls}>
              <InputNumber
                min={1}
                max={10000}
                value={simRuns}
                onChange={(v) => setSimRuns(v ?? 0)}
                style={{ width: 90 }}
                placeholder="Runs"
                disabled={isRunning}
              />
              <span style={{ fontSize: 12, color: '#8c8c8c' }}>runs</span>
              {isRunning ? (
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={handleStopSimulation}
                  style={{ flex: 1 }}
                >
                  Stop ({completedCount}/{totalCount})
                </Button>
              ) : (
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={handleBatchSimulation}
                  style={{ flex: 1 }}
                >
                  Batch Sim
                </Button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {isRunning && (
            <div className={styles.progressSection}>
              <Progress
                percent={progress}
                status="active"
                format={() => `${completedCount}/${totalCount}`}
              />
            </div>
          )}
        </div>

        {/* Results Panel */}
        <div className={styles.resultsPanel}>
          {/* Stats Cards */}
          <div className={styles.statsCardsGrid}>
            <div className={`${styles.statCard} ${batchStats ? styles.statCardHighlight : ''}`}>
              <div className={styles.statCardValue}>
                {batchStats ? `${(batchStats.playerWinRate * 100).toFixed(0)}%` : '--'}
              </div>
              <div className={styles.statCardLabel}>Win Rate</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statCardValue}>
                {batchStats ? batchStats.totalBattles : singleBattleResult?.totalTurns ?? '--'}
              </div>
              <div className={styles.statCardLabel}>
                {batchStats ? 'Total Battles' : 'Turns'}
              </div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statCardValue}>
                {batchStats ? batchStats.averageTurns.toFixed(1) : '--'}
              </div>
              <div className={styles.statCardLabel}>Avg Turns</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statCardValue}>
                {singleBattleResult
                  ? singleBattleResult.playerFinalHp
                  : batchStats
                  ? batchStats.averagePlayerHp.toFixed(0)
                  : '--'}
              </div>
              <div className={styles.statCardLabel}>
                {singleBattleResult ? 'Player HP Left' : 'Avg HP Left'}
              </div>
            </div>
          </div>

          {/* Difficulty Chart */}
          <Card className={styles.difficultyCard}>
            <div className={styles.difficultyCardTitle}>📊 Difficulty Distribution</div>
            <div className={styles.difficultyBars}>
              {batchStats ? (
                Object.entries(DIFFICULTY_CONFIG).map(([key, config]) => {
                  const count = batchStats.difficultyDistribution[key as keyof typeof DIFFICULTY_CONFIG];
                  const percent = batchStats.totalBattles > 0
                    ? (count / batchStats.totalBattles) * 100
                    : 0;
                  return (
                    <div key={key} className={styles.difficultyBar}>
                      <span className={styles.difficultyLabel}>{config.label}</span>
                      <div className={styles.difficultyBarTrack}>
                        <div
                          className={styles.difficultyBarFill}
                          style={{
                            width: `${Math.max(percent, count > 0 ? 15 : 0)}%`,
                            backgroundColor: config.color,
                          }}
                        >
                          {count > 0 && <span className={styles.difficultyBarText}>{count}</span>}
                        </div>
                      </div>
                      <span className={styles.difficultyPercent}>{percent.toFixed(0)}%</span>
                    </div>
                  );
                })
              ) : singleBattleResult && currentDifficulty ? (
                <>
                  <div className={styles.difficultyBar}>
                    <span className={styles.difficultyLabel}>
                      {DIFFICULTY_CONFIG[currentDifficulty].label}
                    </span>
                    <div className={styles.difficultyBarTrack}>
                      <div
                        className={styles.difficultyBarFill}
                        style={{
                          width: '100%',
                          backgroundColor: DIFFICULTY_CONFIG[currentDifficulty].color,
                        }}
                      >
                        <span className={styles.difficultyBarText}>
                          {DIFFICULTY_CONFIG[currentDifficulty].description}
                        </span>
                      </div>
                    </div>
                    <span className={styles.difficultyPercent}>100%</span>
                  </div>
                </>
              ) : (
                <div className={styles.emptyState}>
                  <div className={styles.emptyStateIcon}>📈</div>
                  <div className={styles.emptyStateTitle}>No Data</div>
                  <div className={styles.emptyStateDesc}>
                    Click "Single Battle" or "Batch Sim" to start
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Battle Log */}
          <Card className={styles.battleLogCard}>
            <div className={styles.battleLogTitle}>📜 Sample Battle Log</div>
            <div className={styles.battleLogContent}>
              {singleBattleResult ? (
                <>
                  <div className={`${styles.battleLogLine} ${styles.battleLogResult}`}>
                    {'='.repeat(30)}
                  </div>
                  <div className={styles.battleLogLine}>
                    Turns: {singleBattleResult.totalTurns}
                  </div>
                  <div className={`${styles.battleLogLine} ${styles.battleLogResult}`}>
                    Winner: {singleBattleResult.winner === 'player' ? '🎉 Player' : singleBattleResult.winner === 'monster' ? '💀 Monster' : '⚖️ Draw'}
                  </div>
                  <div className={styles.battleLogLine}>
                    Player HP: {singleBattleResult.playerFinalHp}/{singleBattleResult.playerStartingHp}
                  </div>
                  <div className={styles.battleLogLine}>
                    Monster HP: {singleBattleResult.monsterFinalHp}/{singleBattleResult.monsterStartingHp}
                  </div>
                  <div className={`${styles.battleLogLine} ${styles.battleLogResult}`}>
                    {'='.repeat(30)}
                  </div>
                  <div className={styles.battleLogLine} style={{ marginTop: 8 }}>
                    {'─'.repeat(25)}
                  </div>
                  {singleBattleResult.turns.map((turn, i) => (
                    <div key={i} className={styles.battleLogLine}>
                      <span className={styles.battleLogTurn}>[T{turn.turnNumber}]</span>{' '}
                      <span className={styles.battleLogPlayer}>{turn.attacker}</span>{' → '}
                      <span className={styles.battleLogDamage}>-{turn.damage}</span>{' '}
                      <span className={styles.battleLogMonster}>({turn.defender}: {turn.defenderHpAfter})</span>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ textAlign: 'center', color: '#8c8c8c', padding: '20px' }}>
                  Click "Single Battle" to view battle log
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
