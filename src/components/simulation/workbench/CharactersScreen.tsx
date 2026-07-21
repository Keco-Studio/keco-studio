'use client';

import { useState } from 'react';
import { createCharSnapshot, sortRosterByTeam } from '@/lib/simulation/data';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import type { Team } from '@/lib/simulation/types';
import { SimulationButton } from './SimulationButton';
import styles from './SimulationWorkbench.module.css';

export function CharactersScreen({ onContinue }: { onContinue: () => void }) {
  const { activeSession, updateRoster } = useSimulationSession();
  const [search, setSearch] = useState('');
  if (!activeSession?.importedSnapshot) return <div className={styles.emptyState}>Import Studio libraries first.</div>;
  const snapshot = activeSession.importedSnapshot;
  const roster = activeSession.roster;
  const filtered = snapshot.catalog.characters.filter((character) =>
    (character.name + ' ' + (character.cls ?? '')).toLowerCase().includes(search.toLowerCase()));
  const counts = { A: roster.filter(({ team }) => team === 'A').length, B: roster.filter(({ team }) => team === 'B').length };

  function toggle(tmplId: string) {
    const current = roster.find((entry) => entry.tmplId === tmplId);
    if (current) updateRoster(activeSession!.id, roster.filter(({ uid }) => uid !== current.uid));
    else {
      const team: Team = counts.A <= counts.B ? 'A' : 'B';
      const uid = tmplId + '-' + crypto.randomUUID();
      updateRoster(activeSession!.id, sortRosterByTeam([...roster, { uid, tmplId, team, snapshot: createCharSnapshot(tmplId, snapshot.catalog) }], snapshot.catalog));
    }
  }

  function setTeam(uid: string, team: Team) {
    updateRoster(activeSession!.id, sortRosterByTeam(roster.map((entry) => entry.uid === uid ? { ...entry, team } : entry), snapshot.catalog));
  }

  return <section className={styles.flowScreen} aria-labelledby="characters-title">
    <div className={styles.flowHeading}><div><h2 id="characters-title">Configure characters</h2><p>Pick the fighters that take the field and split them into Team A (yours) and Team B (enemy).</p></div><input type="search" placeholder="Search characters…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className={styles.teamSummary}><article><span>Team A · Yours</span><strong>{counts.A}</strong></article><article><span>Team B · Enemy</span><strong>{counts.B}</strong></article></div>
    <div className={styles.catalogPanel}><span className={styles.sectionLabel}>Character library</span><div className={styles.characterPicker}>{filtered.map((character) => {
      const selected = roster.some(({ tmplId }) => tmplId === character.id);
      return <button type="button" aria-pressed={selected} className={styles.characterChoice} key={character.id} onClick={() => toggle(character.id)}><strong>{character.name}</strong><span>{character.cls || character.el}</span></button>;
    })}</div></div>
    {roster.length ? <div className={styles.snapshotNote}><span aria-hidden="true">i</span><p>Studio snapshot — original character data from import; unaffected by progression.</p></div> : null}
    <div className={styles.rosterTable}>{roster.map((entry) => {
      const character = snapshot.catalog.characters.find(({ id }) => id === entry.tmplId)!;
      return <div className={styles.rosterRow} key={entry.uid}><strong>{character.name}</strong><span>{character.hp} HP · {character.atk} ATK · {character.def} DEF</span><select aria-label={'Team for ' + character.name} value={entry.team} onChange={(event) => setTeam(entry.uid, event.target.value as Team)}><option value="A">Team A</option><option value="B">Team B</option></select><button type="button" onClick={() => toggle(entry.tmplId)}>Remove</button></div>;
    })}</div>
    <div className={styles.flowActions}><span>Team A: {counts.A} · Team B: {counts.B}</span><SimulationButton variant="primary" disabled={!counts.A || !counts.B} onClick={onContinue}>Continue to skills</SimulationButton></div>
  </section>;
}
