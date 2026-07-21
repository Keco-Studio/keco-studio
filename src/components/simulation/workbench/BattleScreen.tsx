'use client';

import { useCallback, useState } from 'react';
import { useBattlePlayback } from '@/lib/simulation/useBattlePlayback';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import { Arena } from './Arena';
import { SimulationButton } from './SimulationButton';
import styles from './SimulationWorkbench.module.css';

export function BattleScreen() {
  const { activeSession, updateProgression } = useSimulationSession();
  const [batchCount, setBatchCount] = useState(50);
  const [batchResult, setBatchResult] = useState<ReturnType<ReturnType<typeof useBattlePlayback>['runBatch']> | null>(null);
  const session = activeSession;
  const snapshot = session?.importedSnapshot;
  const ready = Boolean(session && snapshot && session.roster.some(({ team }) => team === 'A') && session.roster.some(({ team }) => team === 'B') && session.roster.every(({ uid }) => (session.loadout[uid] ?? []).length));

  const complete = useCallback((result: { winner: 'A' | 'B' }) => {
    if (!session?.importedSnapshot) return;
    const reward = session.roster.filter(({ team }) => team !== result.winner).length * 70;
    for (const entry of session.roster.filter(({ team }) => team === result.winner)) {
      let exp = (session.progression.exp[entry.uid] ?? 0) + reward;
      let lv = session.progression.lv[entry.uid] ?? 1;
      let sp = session.progression.sp[entry.uid] ?? 2;
      while (true) {
        const rule = session.importedSnapshot.levelRules.find((item) => item.level === lv);
        if (!rule || exp < rule.exp || lv >= session.importedSnapshot.levelRules.length) break;
        exp -= rule.exp; lv += 1; sp += rule.sp;
      }
      updateProgression(session.id, entry.uid, exp, lv, sp);
    }
  }, [session, updateProgression]);

  const playback = useBattlePlayback({
    scopeKey: `${snapshot?.sourceProjectId ?? ''}:${session?.id ?? ''}:${snapshot?.importedAt ?? ''}`,
    catalog: snapshot?.catalog ?? { characters: [], skills: [], basic: { id: 'basic', name: 'Strike', el: 'Physical', mp: 0, power: 70, cd: 0, kind: 'dmg' } },
    roster: session?.roster ?? [], loadout: session?.loadout ?? {}, skillLevels: session?.skillLevels ?? {}, onComplete: complete,
  });
  if (!session || !snapshot) return <div className={styles.emptyState}>Import a simulator before battle.</div>;
  const currentEvent = playback.logs.at(-1);
  const fighters = playback.units.map((unit) => {
    const receivesFeedback = unit.uid === currentEvent?.target
      && (currentEvent.type === 'dmg' || currentEvent.type === 'dot' || currentEvent.type === 'heal');
    return {
      uid: unit.uid,
      name: unit.name,
      team: unit.team,
      hp: unit.hp,
      maxHp: unit.maxHp,
      mp: unit.mp,
      maxMp: unit.maxMp,
      detail: unit.cls,
      active: unit.uid === playback.activeActor,
      hit: unit.uid === playback.activeTarget && currentEvent?.type === 'dmg',
      effect: unit.uid === playback.activeTarget ? 'Targeted' : null,
      feedback: receivesFeedback
        ? {
            key: playback.logs.length,
            value: `${currentEvent.type === 'heal' ? '+' : '-'}${currentEvent.amount ?? ''}`,
            tone: currentEvent.type === 'heal' ? 'heal' as const : 'damage' as const,
          }
        : null,
    };
  });

  return <section className={styles.flowScreen} aria-labelledby="battle-title">
    <div className={styles.flowHeading}><div><span className={styles.kicker}>Arena and batch</span><h2 id="battle-title">Battle</h2><p>Run one animated battle or compare up to 500 deterministic simulation runs.</p></div><SimulationButton variant="primary" disabled={!ready || playback.phase === 'running'} onClick={playback.start}>Start battle</SimulationButton></div>
    {!ready ? <div className={styles.errorList} role="alert">Each team needs a fighter and every fighter needs at least one skill.</div> : null}
    <div className={styles.battleWorkspace}><div className={styles.battleLog}><strong>Battle log</strong>{playback.logs.map((event, index) => <p key={index}><b>{event.tag}</b> {event.text}</p>)}</div><Arena fighters={fighters} round={playback.round} caption={playback.phase === 'running' ? 'Fighting' : playback.result ? 'Team ' + playback.result.winner + ' wins' : 'Ready'} /></div>
    <div className={styles.batchPanel}><label className={styles.fieldLabel}>Runs<input type="number" min={1} max={500} value={batchCount} onChange={(event) => setBatchCount(Number(event.target.value))} /></label><SimulationButton disabled={!ready} onClick={() => setBatchResult(playback.runBatch(batchCount))}>Run batch</SimulationButton>{batchResult ? <strong>Team A: {batchResult.teamAWins}/{batchResult.runs} ({batchResult.teamAWinRate}%)</strong> : null}</div>
  </section>;
}
