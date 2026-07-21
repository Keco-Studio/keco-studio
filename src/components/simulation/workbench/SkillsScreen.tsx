'use client';

import { useMemo, useState } from 'react';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import { SimulationButton } from './SimulationButton';
import styles from './SimulationWorkbench.module.css';

export function SkillsScreen({ onContinue }: { onContinue: () => void }) {
  const { activeSession, updateSkills } = useSimulationSession();
  const [activeUid, setActiveUid] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const session = activeSession;
  const snapshot = session?.importedSnapshot;
  const selectedUid = activeUid && session?.roster.some(({ uid }) => uid === activeUid) ? activeUid : session?.roster[0]?.uid ?? null;
  const allReady = Boolean(session?.roster.length && session.roster.every(({ uid }) => (session.loadout[uid] ?? []).length));
  const skills = useMemo(() => snapshot?.catalog.skills.filter((skill) => (skill.name + ' ' + skill.el + ' ' + (skill.fx ?? '')).toLowerCase().includes(search.toLowerCase())) ?? [], [search, snapshot]);
  if (!session || !snapshot || !selectedUid) return <div className={styles.emptyState}>Add characters before configuring skills.</div>;
  const equipped = session.loadout[selectedUid] ?? [];

  function toggle(skillId: string) {
    const current = session!.loadout[selectedUid!] ?? [];
    const next = current.includes(skillId) ? current.filter((id) => id !== skillId) : (current.length >= 6 ? current : [...current, skillId]);
    const levels = { ...(session!.skillLevels[selectedUid!] ?? {}) };
    if (next.includes(skillId)) levels[skillId] ??= 1; else delete levels[skillId];
    updateSkills(session!.id, selectedUid!, next, levels);
  }

  return <section className={styles.flowScreen} aria-labelledby="skills-title">
    <div className={styles.flowHeading}><div><h2 id="skills-title">Config skills</h2><p>Assign up to six skills per fighter. Every fighter needs at least one skill before battle.</p></div><input type="search" placeholder="Search skills…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className={styles.splitLayout}><div><span className={styles.sectionLabel}>Roster</span><nav className={styles.rosterNav} aria-label="Fighters">{session.roster.map((entry) => {
      const character = snapshot.catalog.characters.find(({ id }) => id === entry.tmplId)!;
      return <button type="button" aria-current={entry.uid === selectedUid ? 'true' : undefined} key={entry.uid} onClick={() => setActiveUid(entry.uid)}><strong>{character.name}</strong><span>{(session.loadout[entry.uid] ?? []).length}/6 · Team {entry.team}</span></button>;
    })}</nav></div><div className={styles.skillLibrary}><div className={styles.skillLibraryHeader}><span><strong>Skill library</strong><small>Selected skills {equipped.length}/6</small></span><span>Name · Element · PWR · MP · CD</span></div><div className={styles.skillGrid}>{skills.map((skill) => {
      const selected = equipped.includes(skill.id); const full = equipped.length >= 6 && !selected;
      return <button type="button" disabled={full} aria-pressed={selected} className={styles.skillChoice} key={skill.id} onClick={() => toggle(skill.id)}><strong>{skill.name}</strong><span>{skill.el} · {skill.power} PWR · {skill.mp} MP · CD {skill.cd}</span><small>{skill.fx}</small></button>;
    })}</div></div></div>
    <div className={styles.flowActions}><span>{allReady ? 'Every fighter has a loadout.' : 'Every fighter needs at least one skill.'}</span><SimulationButton variant="primary" disabled={!allReady} onClick={onContinue}>Continue to progression</SimulationButton></div>
  </section>;
}
