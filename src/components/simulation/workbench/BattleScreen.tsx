'use client';

import { useCallback, useState } from 'react';
import { useBattlePlayback } from '@/lib/simulation/useBattlePlayback';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import { Arena } from './Arena';
import { SimulationButton } from './SimulationButton';
import styles from './SimulationWorkbench.module.css';

type BattleOutcome = {
  winner: 'A' | 'B';
  exp: number;
  levelUps: number;
};

function logTone(type: string): string {
  if (type === 'ko') return 'var(--keco-danger)';
  if (type === 'heal') return 'var(--keco-success)';
  if (type === 'status' || type === 'dot' || type === 'buff') return 'var(--keco-purple)';
  return 'var(--ink-500)';
}

export function BattleScreen({ onContinue }: { onContinue?: () => void }) {
  const { activeSession, updateProgression } = useSimulationSession();
  const [batchCount, setBatchCount] = useState(50);
  const [batchResult, setBatchResult] = useState<ReturnType<ReturnType<typeof useBattlePlayback>['runBatch']> | null>(null);
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  const session = activeSession;
  const snapshot = session?.importedSnapshot;
  const ready = Boolean(
    session
    && snapshot
    && session.roster.some(({ team }) => team === 'A')
    && session.roster.some(({ team }) => team === 'B')
    && session.roster.every(({ uid }) => (session.loadout[uid] ?? []).length),
  );

  const complete = useCallback((result: { winner: 'A' | 'B' }) => {
    if (!session?.importedSnapshot) return;
    const reward = session.roster.filter(({ team }) => team !== result.winner).length * 70;
    let levelUps = 0;
    for (const entry of session.roster.filter(({ team }) => team === result.winner)) {
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
    setOutcome({ winner: result.winner, exp: reward, levelUps });
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
    onComplete: complete,
  });

  if (!session || !snapshot) {
    return <div className={styles.emptyState}>Import a simulator before battle.</div>;
  }

  const currentEvent = playback.logs.at(-1);
  const fighters = playback.units.map((unit) => {
    const receivesFeedback = unit.uid === currentEvent?.target
      && (currentEvent.type === 'dmg' || currentEvent.type === 'dot' || currentEvent.type === 'heal');
    return {
      uid: unit.uid,
      name: unit.name,
      team: unit.team,
      el: unit.el,
      initial: unit.initial,
      alive: unit.alive,
      hp: unit.hp,
      maxHp: unit.maxHp,
      mp: unit.mp,
      maxMp: unit.maxMp,
      detail: unit.cls,
      active: unit.uid === playback.activeActor,
      hit: unit.uid === playback.activeTarget && currentEvent?.type === 'dmg',
      feedback: receivesFeedback
        ? {
            key: playback.logs.length,
            value: `${currentEvent.type === 'heal' ? '+' : '-'}${currentEvent.amount ?? ''}`,
            tone: currentEvent.type === 'heal' ? 'heal' as const : 'damage' as const,
          }
        : null,
    };
  });

  if (playback.phase === 'idle') {
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
              disabled={!ready}
              onClick={() => {
                setOutcome(null);
                playback.start();
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

  const battleDone = playback.phase === 'done';
  const winnerTeam = outcome?.winner ?? playback.result?.winner ?? 'A';
  const winnerColor = winnerTeam === 'A' ? 'var(--keco-blue)' : 'var(--keco-pink-strong)';
  const winnerLabel = winnerTeam === 'A' ? 'Team A' : 'Team B';
  const totalEvents = Math.max(playback.logs.length, 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px - 90px)', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)' }}>Arena</span>
          <span style={{ fontSize: 13, color: 'var(--ink-450)' }}>
            Turn {playback.round} / {totalEvents}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
            padding: '3px 9px', borderRadius: 6,
            color: playback.phase === 'running' ? 'var(--keco-running)' : 'var(--ink-450)',
            background: playback.phase === 'running' ? '#FEF3C7' : 'var(--surface-1)',
            animation: playback.phase === 'running' ? 'kPulse 1.2s infinite' : 'none',
          }}
          >
            {playback.phase === 'running' ? '● Fighting' : 'Finished'}
          </span>
        </div>
        <SimulationButton variant="secondary" onClick={playback.stop}>Stop battle</SimulationButton>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, flex: 1, minHeight: 0 }}>
        <div style={{
          background: '#fff', border: '1px solid var(--line-200)', borderRadius: 14,
          display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
        }}
        >
          <div style={{
            fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em',
            color: 'var(--ink-500)', padding: '14px 16px', borderBottom: '1px solid var(--line-100)',
          }}
          >
            Battle log
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {playback.logs.map((event, index) => (
              <div
                key={index}
                style={{
                  fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink-700)',
                  paddingBottom: event.type === 'ko' ? 4 : 0,
                }}
              >
                <span style={{
                  fontSize: 9.5, fontWeight: 800, letterSpacing: '.04em', color: '#fff',
                  background: logTone(event.type), padding: '2px 6px', borderRadius: 5, marginRight: 2,
                }}
                >
                  {event.tag}
                </span>
                {' '}
                {event.text}
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative', minHeight: 0 }}>
          <Arena fighters={fighters} round={playback.round} />
          {battleDone && outcome ? (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(15,23,42,.42)', backdropFilter: 'blur(2px)',
              borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            >
              <div style={{
                background: '#fff', borderRadius: 16, padding: '30px 40px', textAlign: 'center',
                boxShadow: 'var(--shadow-modal)', minWidth: 300,
              }}
              >
                <div style={{ fontFamily: 'var(--font-koulen)', fontSize: 34, letterSpacing: '.03em', color: winnerColor }}>
                  {winnerLabel}
                  {' '}
                  Wins
                </div>
                <div style={{ fontSize: 14, color: 'var(--ink-500)', margin: '8px 0 22px' }}>
                  +
                  {outcome.exp}
                  {' '}
                  EXP to
                  {' '}
                  {winnerLabel}
                  {outcome.levelUps
                    ? ` · ${outcome.levelUps} level-up${outcome.levelUps > 1 ? 's' : ''}`
                    : ''}
                </div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  <SimulationButton
                    variant="secondary"
                    onClick={() => {
                      setOutcome(null);
                      playback.start();
                    }}
                  >
                    Battle again
                  </SimulationButton>
                  <SimulationButton
                    variant="primary"
                    onClick={() => {
                      playback.stop();
                      onContinue?.();
                    }}
                  >
                    Continue →
                  </SimulationButton>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
