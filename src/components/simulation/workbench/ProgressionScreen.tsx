'use client';

import { useState } from 'react';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import { SimulationButton } from './SimulationButton';
import styles from './SimulationWorkbench.module.css';

export function ProgressionScreen({ onContinue }: { onContinue: () => void }) {
  const { activeSession, updateSkills, updateProgression } = useSimulationSession();
  const [activeUid, setActiveUid] = useState<string | null>(null);
  const session = activeSession;
  const snapshot = session?.importedSnapshot;
  const uid = activeUid && session?.roster.some((entry) => entry.uid === activeUid) ? activeUid : session?.roster[0]?.uid ?? null;
  if (!session || !snapshot || !uid) return <div className={styles.emptyState}>Configure characters and skills first.</div>;
  const entry = session.roster.find((item) => item.uid === uid)!;
  const character = snapshot.catalog.characters.find(({ id }) => id === entry.tmplId)!;
  const exp = session.progression.exp[uid] ?? 0;
  const level = session.progression.lv[uid] ?? 1;
  const points = session.progression.sp[uid] ?? 2;
  const equipped = session.loadout[uid] ?? [];
  const levels = session.skillLevels[uid] ?? {};

  function upgrade(skillId: string) {
    const current = levels[skillId] ?? 1;
    const cost = snapshot!.skillCostRules.find(({ lv }) => lv === current)?.cost;
    if (cost === undefined || points < cost) return;
    updateSkills(session!.id, uid!, equipped, { ...levels, [skillId]: current + 1 });
    updateProgression(session!.id, uid!, exp, level, points - cost);
  }

  function reset(skillId: string) {
    const current = levels[skillId] ?? 1;
    let refund = 0;
    for (let lv = 1; lv < current; lv += 1) refund += snapshot!.skillCostRules.find((rule) => rule.lv === lv)?.cost ?? 0;
    updateSkills(session!.id, uid!, equipped, { ...levels, [skillId]: 1 });
    updateProgression(session!.id, uid!, exp, level, points + refund);
  }

  return <section className={styles.flowScreen} aria-labelledby="progression-title">
    <div className={styles.flowHeading}><div><h2 id="progression-title">Progression</h2><p>Spend <b>SP</b> to level skills. Win battles to earn EXP; each level-up grants skill points and stays local.</p></div></div>
    <div className={styles.splitLayout}><div><span className={styles.sectionLabel}>Roster</span><nav className={styles.rosterNav} aria-label="Fighters">{session.roster.map((item) => {
      const template = snapshot.catalog.characters.find(({ id }) => id === item.tmplId)!;
      return <button type="button" aria-current={item.uid === uid ? 'true' : undefined} key={item.uid} onClick={() => setActiveUid(item.uid)}><strong>{template.name}</strong><span>Lv {session.progression.lv[item.uid] ?? 1} · {session.progression.sp[item.uid] ?? 2} SP</span></button>;
    })}</nav></div><div className={styles.progressionWorkspace}><article className={styles.characterProgress}><div className={styles.progressIdentity}><span>{character.name.slice(0, 1)}</span><div><h3>{character.name}</h3><p>{character.cls} · Team {entry.team}</p></div></div><div className={styles.progressStats}><span><small>Level</small><strong>{level}</strong></span><span><small>Skill points</small><strong>{points}</strong></span></div><div className={styles.expTrack}><span><small>EXP</small><small>{exp}</small></span><i style={{ width: `${Math.min(100, exp)}%` }} /></div><div className={styles.baseStats}>{[['HP', character.hp], ['ATK', character.atk], ['DEF', character.def], ['SPD', character.spd], ['MP', character.mp]].map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div></article><article className={styles.equippedSkills}><span className={styles.sectionLabel}>Equipped skills</span><div className={styles.mappingList}>{equipped.map((skillId) => {
      const skill = snapshot.catalog.skills.find(({ id }) => id === skillId)!;
      const skillLevel = levels[skillId] ?? 1;
      const cost = snapshot.skillCostRules.find(({ lv }) => lv === skillLevel)?.cost;
      return <div className={styles.progressRow} key={skillId}><span><strong>{skill.name}</strong><small>Level {skillLevel}{cost === undefined ? ' · Max' : ' · ' + cost + ' SP next'}</small></span><SimulationButton size="small" disabled={cost === undefined || points < cost} onClick={() => upgrade(skillId)}>Upgrade</SimulationButton><SimulationButton size="small" variant="quiet" disabled={skillLevel <= 1} onClick={() => reset(skillId)}>Reset</SimulationButton></div>;
    })}</div></article></div></div>
    <div className={styles.flowActions}><span>Level curve contains {snapshot.levelRules.length} levels.</span><SimulationButton variant="primary" onClick={onContinue}>Open battle</SimulationButton></div>
  </section>;
}
