'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BattleSession } from '@keco/battle-core';
import {
  BattleArena,
  type BattleArenaConfig,
  type BattleArenaUiState,
} from './BattleArena/BattleArena';
import styles from './StartBattleStep.module.css';

export type BattleRewardSummary = {
  exp: number;
  levelUps: number;
  winnerLabel: string;
};

type Props = {
  arenaConfig: BattleArenaConfig;
  onStop: () => void;
  /** CONTINUE on the result overlay — typically return to Progression. */
  onContinue?: () => void;
  /** Fired once per finished battle when A or B wins (not fled/draw). */
  onBattleEnded?: (winner: 'A' | 'B', session: BattleSession) => BattleRewardSummary | void;
};

function pct(current: number, max: number) {
  return max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
}

function FighterBars({
  name,
  hp,
  maxHp,
  mp,
  maxMp,
  variant,
}: {
  name: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  variant: 'player' | 'enemy';
}) {
  return (
    <div className={`${styles.fighter} ${variant === 'player' ? styles.fighterPlayer : styles.fighterEnemy}`}>
      <div className={styles.fighterHead}>
        <span className={styles.fighterName}>{name}</span>
      </div>
      <div className={styles.barRow}>
        <span className={styles.barLabel}>HP</span>
        <div className={styles.barTrack}>
          <div className={styles.barFillHp} style={{ width: `${pct(hp, maxHp)}%` }} />
        </div>
        <span className={styles.barValue}>
          {Math.round(hp)}/{Math.round(maxHp)}
        </span>
      </div>
      <div className={styles.barRow}>
        <span className={styles.barLabel}>MP</span>
        <div className={styles.barTrack}>
          <div
            className={styles.barFillMp}
            style={{ width: `${pct(Math.max(0, mp), maxMp)}%` }}
          />
        </div>
        <span className={styles.barValue}>
          {Math.max(0, Math.round(mp))}/{Math.round(maxMp)}
        </span>
      </div>
    </div>
  );
}

function sessionWinner(session: BattleSession): 'A' | 'B' | null {
  if (session.result === 'left_win') return 'A';
  if (session.result === 'right_win') return 'B';
  return null;
}

function formatRewardLine(summary: BattleRewardSummary): string {
  const levelPart = summary.levelUps > 0
    ? ` · ${summary.levelUps} level-up${summary.levelUps > 1 ? 's' : ''}`
    : '';
  return `+${summary.exp} EXP to ${summary.winnerLabel}${levelPart}`;
}

export function StudioBattleStep({ arenaConfig, onStop, onContinue, onBattleEnded }: Props) {
  const logBodyRef = useRef<HTMLDivElement>(null);
  const rewardAppliedRef = useRef(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [battleUi, setBattleUi] = useState<BattleArenaUiState>(() => ({
    tick: 0,
    phase: 'preparation',
    playerHp: arenaConfig.playerHp,
    playerMaxHp: arenaConfig.playerStats.maxHp,
    playerMp: arenaConfig.playerMp,
    playerMaxMp: arenaConfig.playerMaxMp,
    enemyHp: arenaConfig.enemyHp,
    enemyMaxHp: arenaConfig.enemyStats.maxHp,
    enemyMp: arenaConfig.enemyMp,
    enemyMaxMp: arenaConfig.enemyMaxMp,
  }));

  const handleLogLinesChange = useCallback((lines: string[]) => {
    setLogLines(lines);
  }, []);

  const handleBattleStateChange = useCallback((state: BattleArenaUiState) => {
    setBattleUi(state);
  }, []);

  const handleFinished = useCallback(
    (session: BattleSession): string[] | void => {
      if (rewardAppliedRef.current) return;
      const winner = sessionWinner(session);
      if (!winner) return;
      rewardAppliedRef.current = true;
      const summary = onBattleEnded?.(winner, session);
      if (summary) return [formatRewardLine(summary)];
      return [`+70 EXP to ${winner === 'A' ? 'Team A' : 'Team B'}`];
    },
    [onBattleEnded],
  );

  const handleBattleReset = useCallback(() => {
    rewardAppliedRef.current = false;
  }, []);

  useEffect(() => {
    const el = logBodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines.length]);

  return (
    <div className={styles.root}>
      <aside className={styles.logPanel}>
        <div className={styles.logTitle}>Battle logs</div>
        <div ref={logBodyRef} className={styles.logBody}>
          {logLines.length === 0 ? (
            <div className={styles.logLine}>Waiting for battle events…</div>
          ) : (
            logLines.map((line, i) => (
              <div key={i} className={styles.logLine}>
                {line}
              </div>
            ))
          )}
        </div>
        <div className={styles.progressionDisabled}>
          Winning team gains EXP. Continue returns to Progression.
        </div>
      </aside>

      <section className={styles.rightCol}>
        <div className={styles.arenaStage}>
          <div className={styles.arenaFrame}>
            <BattleArena
              config={arenaConfig}
              presentation="design"
              hideInternalLog
              onLogLinesChange={handleLogLinesChange}
              onBattleStateChange={handleBattleStateChange}
              onFinished={handleFinished}
              onBattleReset={handleBattleReset}
              onStop={onStop}
              onContinue={onContinue ?? onStop}
            />
          </div>
        </div>

        <div className={styles.statusBar}>
          <div className={styles.statusMain}>
            <FighterBars
              variant="player"
              name={arenaConfig.playerName}
              hp={battleUi.playerHp}
              maxHp={battleUi.playerMaxHp}
              mp={battleUi.playerMp}
              maxMp={battleUi.playerMaxMp}
            />
            <FighterBars
              variant="enemy"
              name={arenaConfig.enemyName}
              hp={battleUi.enemyHp}
              maxHp={battleUi.enemyMaxHp}
              mp={battleUi.enemyMp}
              maxMp={battleUi.enemyMaxMp}
            />
          </div>
          <div className={styles.statusActions}>
            <span className={styles.tickLabel}>
              T{battleUi.tick} · {battleUi.phase}
            </span>
            <button type="button" className={styles.stopBtn} onClick={onStop}>
              Stop battle
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
