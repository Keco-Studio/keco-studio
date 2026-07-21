'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildFighters, displayUnits, simulate } from './battleEngine';
import type { BattleEvent, BattleResult, Loadout, RosterEntry, SimulationCatalog, SkillLevels } from './types';

type DisplayUnit = ReturnType<typeof displayUnits>[number];
type PlaybackPhase = 'idle' | 'running' | 'done';

export function useBattlePlayback({ catalog, roster, loadout, skillLevels, intervalMs = 420, random, onComplete }: {
  catalog: SimulationCatalog;
  roster: readonly RosterEntry[];
  loadout: Loadout;
  skillLevels: SkillLevels;
  intervalMs?: number;
  random?: () => number;
  onComplete?: (result: BattleResult) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsRef = useRef<BattleEvent[]>([]);
  const resultRef = useRef<BattleResult | null>(null);
  const eventIndexRef = useRef(0);
  const [phase, setPhase] = useState<PlaybackPhase>('idle');
  const [units, setUnits] = useState<DisplayUnit[]>([]);
  const [logs, setLogs] = useState<BattleEvent[]>([]);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [activeActor, setActiveActor] = useState<string | null>(null);
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);
  const stop = useCallback(() => {
    clearTimer();
    setPhase('idle');
    setActiveActor(null);
    setActiveTarget(null);
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const start = useCallback(() => {
    clearTimer();
    const battle = simulate(catalog, roster, loadout, skillLevels, true, random);
    resultRef.current = battle;
    eventsRef.current = battle.events;
    eventIndexRef.current = 0;
    setUnits(displayUnits(buildFighters(catalog, roster, loadout, skillLevels)));
    setLogs([]);
    setResult(null);
    setRound(0);
    setPhase('running');
    timerRef.current = setInterval(() => {
      const event = eventsRef.current[eventIndexRef.current++];
      if (!event) {
        clearTimer();
        const completed = resultRef.current;
        setPhase('done');
        setActiveActor(null);
        setActiveTarget(null);
        setResult(completed);
        if (completed) onComplete?.(completed);
        return;
      }
      const snapshots = new Map(event.snap.map((snapshot) => [snapshot.uid, snapshot]));
      setUnits((current) => current.map((unit) => {
        const snapshot = snapshots.get(unit.uid);
        return snapshot ? { ...unit, hp: snapshot.hp, mp: snapshot.mp, alive: snapshot.alive } : unit;
      }));
      setLogs((current) => [...current, event]);
      setActiveActor(event.actor);
      setActiveTarget(event.target);
      setRound(eventIndexRef.current);
    }, intervalMs);
  }, [catalog, clearTimer, intervalMs, loadout, onComplete, random, roster, skillLevels]);

  const runBatch = useCallback((count: number) => {
    const runs = Math.max(1, Math.min(500, Math.trunc(count)));
    let teamAWins = 0;
    for (let index = 0; index < runs; index += 1) {
      if (simulate(catalog, roster, loadout, skillLevels, false, random).winner === 'A') teamAWins += 1;
    }
    return { runs, teamAWins, teamBWins: runs - teamAWins, teamAWinRate: Math.round((teamAWins / runs) * 100) };
  }, [catalog, loadout, random, roster, skillLevels]);

  return { phase, units, logs, result, activeActor, activeTarget, round, start, stop, runBatch };
}
