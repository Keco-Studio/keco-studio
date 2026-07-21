'use client';

import { useCallback, useMemo, useState } from 'react';
import type { BattleSession } from '@keco/battle-core';
import { StudioBattleStep } from '@/components/simulation/arena/StudioBattleStep';
import type { BattleArenaConfig } from '@/components/simulation/arena/BattleArena/BattleArena';
import { buildArenaConfigFromSession } from '@/lib/simulation/kecoArenaAdapter';
import { useBattlePlayback } from '@/lib/simulation/useBattlePlayback';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import { SimulationButton } from './SimulationButton';
import styles from './SimulationWorkbench.module.css';

export function BattleScreen({ onContinue }: { onContinue?: () => void }) {
  const { activeSession, updateProgression } = useSimulationSession();
  const [batchCount, setBatchCount] = useState(50);
  const [batchResult, setBatchResult] = useState<ReturnType<ReturnType<typeof useBattlePlayback>['runBatch']> | null>(null);
  const [arenaConfig, setArenaConfig] = useState<BattleArenaConfig | null>(null);
  const session = activeSession;
  const snapshot = session?.importedSnapshot;
  const ready = Boolean(
    session
    && snapshot
    && session.roster.some(({ team }) => team === 'A')
    && session.roster.some(({ team }) => team === 'B')
    && session.roster.every(({ uid }) => (session.loadout[uid] ?? []).length),
  );

  const applyVictoryProgression = useCallback((winner: 'A' | 'B') => {
    if (!session?.importedSnapshot) {
      return { exp: 0, levelUps: 0, winnerLabel: winner === 'A' ? 'Team A' : 'Team B' };
    }
    const reward = session.roster.filter(({ team }) => team !== winner).length * 70;
    let levelUps = 0;
    for (const entry of session.roster.filter(({ team }) => team === winner)) {
      let exp = (session.progression.exp[entry.uid] ?? 0) + reward;
      let lv = session.progression.lv[entry.uid] ?? 1;
      let sp = session.progression.sp[entry.uid] ?? 2;
      while (true) {
        const rule = session.importedSnapshot.levelRules.find((item) => item.level === lv);
        if (!rule || exp < rule.exp || lv >= session.importedSnapshot.levelRules.length) break;
        exp -= rule.exp;
        lv += 1;
        sp += rule.sp;
        levelUps += 1;
      }
      updateProgression(session.id, entry.uid, exp, lv, sp);
    }
    return {
      exp: reward,
      levelUps,
      winnerLabel: winner === 'A' ? 'Team A' : 'Team B',
    };
  }, [session, updateProgression]);

  const playback = useBattlePlayback({
    scopeKey: `${snapshot?.sourceProjectId ?? ''}:${session?.id ?? ''}:${snapshot?.importedAt ?? ''}`,
    catalog: snapshot?.catalog ?? {
      characters: [],
      skills: [],
      basic: { id: 'basic', name: 'Strike', el: 'Physical', mp: 0, power: 70, cd: 0, kind: 'dmg' },
    },
    roster: session?.roster ?? [],
    loadout: session?.loadout ?? {},
    skillLevels: session?.skillLevels ?? {},
  });

  const previewArenaConfig = useMemo(() => {
    if (!session || !snapshot) return null;
    return buildArenaConfigFromSession({
      catalog: snapshot.catalog,
      roster: session.roster,
      loadout: session.loadout,
      skillLevels: session.skillLevels,
    });
  }, [session, snapshot]);

  const handleBattleEnded = useCallback((winner: 'A' | 'B', _battle: BattleSession) => {
    return applyVictoryProgression(winner);
  }, [applyVictoryProgression]);

  const leaveArenaToProgression = useCallback(() => {
    setArenaConfig(null);
    onContinue?.();
  }, [onContinue]);

  if (!session || !snapshot) {
    return <div className={styles.emptyState}>Import a simulator before battle.</div>;
  }

  if (arenaConfig) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - var(--simulation-header-height, 64px) - 24px)',
        minHeight: 520,
        margin: '-34px -44px -56px',
        overflow: 'hidden',
      }}
      >
        <StudioBattleStep
          arenaConfig={arenaConfig}
          onStop={() => setArenaConfig(null)}
          onContinue={leaveArenaToProgression}
          onBattleEnded={handleBattleEnded}
        />
      </div>
    );
  }

  const rate = batchResult?.teamAWinRate ?? 0;
  const brate = batchResult ? 100 - batchResult.teamAWinRate : 0;
  const balanceCopy = batchResult
    ? (rate >= 45 && rate <= 55
      ? 'Balanced — within the 45–55% target band.'
      : (rate > 55
        ? 'Team A is favoured. Consider buffing the enemy.'
        : 'Team A is underpowered. Consider buffing your side.'))
    : null;

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 27, fontWeight: 600, color: 'var(--ink-900)', margin: '0 0 6px', letterSpacing: '-.01em' }}>Battle</h1>
        <p style={{ color: 'var(--ink-500)', fontSize: 15, margin: 0, maxWidth: 640, lineHeight: 1.55 }}>
          Run one visual battle in the Arena, or batch-simulate to read the win rate. Team A is yours.
        </p>
      </div>
      {!ready ? (
        <div style={{
          display: 'flex', gap: 11, alignItems: 'flex-start', background: 'var(--keco-danger-wash)',
          border: '1px solid #FECACA', color: 'var(--keco-danger)', borderRadius: 10,
          padding: '13px 16px', marginBottom: 22, fontSize: 14, lineHeight: 1.5,
        }}
        >
          <span style={{ fontWeight: 800, fontSize: 16 }}>!</span>
          <span>Each team needs a fighter and every fighter needs at least one skill.</span>
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{ background: '#fff', border: '1px solid var(--line-200)', borderRadius: 16, padding: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11, background: 'var(--keco-blue)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700,
            }}
            >
              ⚔
            </div>
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink-900)' }}>Single battle</span>
          </div>
          <p style={{ color: 'var(--ink-500)', fontSize: 14, lineHeight: 1.55, margin: '0 0 20px' }}>
            Watch a turn-based PVE fight play out on the grid — movement, skills, element reactions and a live log. Win to earn EXP.
          </p>
          <SimulationButton
            variant="primary"
            size="large"
            disabled={!ready || !previewArenaConfig}
            onClick={() => {
              if (!previewArenaConfig) return;
              setArenaConfig(previewArenaConfig);
            }}
          >
            Start battle
          </SimulationButton>
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--line-200)', borderRadius: 16, padding: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11, background: 'var(--keco-purple)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700,
            }}
            >
              ∑
            </div>
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink-900)' }}>Batch simulation</span>
          </div>
          <p style={{ color: 'var(--ink-500)', fontSize: 14, lineHeight: 1.55, margin: '0 0 18px' }}>
            Run N battles in the background and read the win rate. No animation.
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 18 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--ink-500)', fontWeight: 500 }}>
              Runs (1-500)
              <input
                type="number"
                value={batchCount}
                onChange={(event) => setBatchCount(Number(event.target.value))}
                style={{
                  width: 120, height: 40, border: '1px solid var(--line-200)', borderRadius: 10,
                  padding: '0 12px', fontSize: 15, fontFamily: 'var(--font-roboto)', outline: 'none',
                }}
              />
            </label>
            <SimulationButton
              variant="secondary"
              size="large"
              disabled={!ready}
              onClick={() => setBatchResult(playback.runBatch(batchCount))}
            >
              Run batch
            </SimulationButton>
          </div>
          {batchResult ? (
            <div style={{ borderTop: '1px solid var(--line-100)', paddingTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 10 }}>Results ({batchResult.runs} runs)</div>
              <div style={{ display: 'flex', height: 34, borderRadius: 9, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{
                  width: `${rate}%`, background: 'var(--keco-blue)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, minWidth: rate > 0 ? 28 : 0,
                }}
                >
                  {batchResult.teamAWins}
                </div>
                <div style={{
                  width: `${brate}%`, background: 'var(--keco-pink-strong)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, minWidth: brate > 0 ? 28 : 0,
                }}
                >
                  {batchResult.teamBWins}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--keco-blue)', fontWeight: 600 }}>You · {rate}%</span>
                <span style={{ color: 'var(--keco-pink-strong)', fontWeight: 600 }}>Enemy · {brate}%</span>
              </div>
              {balanceCopy ? (
                <div style={{
                  marginTop: 12, fontSize: 12.5, lineHeight: 1.5,
                  color: rate >= 45 && rate <= 55 ? 'var(--keco-success)' : 'var(--ink-500)',
                }}
                >
                  {balanceCopy}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
