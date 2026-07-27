'use client';

import { useState } from 'react';
import { EL, skillPower } from '@/lib/simulation/data';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import type { ElementName } from '@/lib/simulation/types';
import { SimulationButton } from './SimulationButton';
import styles from './SimulationWorkbench.module.css';

function elementOf(el: string) {
  return EL[(el in EL ? el : 'Physical') as ElementName];
}

const factionColor = (team: 'A' | 'B') => (team === 'A' ? 'var(--keco-blue)' : 'var(--keco-pink-strong)');

export function SkillsScreen({ onContinue }: { onContinue: () => void }) {
  const { activeSession, updateSkills } = useSimulationSession();
  const [activeUid, setActiveUid] = useState<string | null>(null);
  const [skillSearch, setSkillSearch] = useState('');
  const session = activeSession;
  const snapshot = session?.importedSnapshot;
  const selectedUid = activeUid && session?.roster.some(({ uid }) => uid === activeUid)
    ? activeUid
    : session?.roster[0]?.uid ?? null;
  const allReady = Boolean(
    session?.roster.length
    && session.roster.every(({ uid }) => (session.loadout[uid] ?? []).length > 0),
  );

  if (!session || !snapshot || !selectedUid) {
    return (
      <div style={{
        border: '1.5px dashed var(--line-300)',
        borderRadius: 14,
        padding: 56,
        textAlign: 'center',
        color: 'var(--ink-400)',
        background: '#fff',
      }}
      >
        Add and confirm characters first.
      </div>
    );
  }

  const equipped = session.loadout[selectedUid] ?? [];
  const sq = skillSearch.toLowerCase();
  const filteredSkills = snapshot.catalog.skills.filter((skill) => (
    skill.name.toLowerCase().includes(sq)
    || skill.el.toLowerCase().includes(sq)
    || (skill.fx ?? '').toLowerCase().includes(sq)
  ));
  const activeRoster = session.roster.find((entry) => entry.uid === selectedUid)!;
  const activeTmpl = snapshot.catalog.characters.find(({ id }) => id === activeRoster.tmplId)!;
  const activeLevels = session.skillLevels[selectedUid] ?? {};
  const activeEl = elementOf(activeTmpl.el);
  const missingSkills = session.roster
    .filter((entry) => (session.loadout[entry.uid] ?? []).length === 0)
    .map((entry) => snapshot.catalog.characters.find(({ id }) => id === entry.tmplId)?.name)
    .filter(Boolean);
  const rdOk = allReady;
  const rdMessage = rdOk
    ? 'All fighters have skills — ready'
    : (missingSkills.length
      ? `Assign at least one skill to: ${missingSkills.join(', ')}.`
      : 'Each side needs a fighter and every fighter needs at least one skill.');

  function toggle(skillId: string) {
    const current = session!.loadout[selectedUid!] ?? [];
    const next = current.includes(skillId)
      ? current.filter((id) => id !== skillId)
      : (current.length >= 6 ? current : [...current, skillId]);
    const levels = { ...(session!.skillLevels[selectedUid!] ?? {}) };
    if (next.includes(skillId)) levels[skillId] ??= 1;
    else delete levels[skillId];
    updateSkills(session!.id, selectedUid!, next, levels);
  }

  return (
    <div style={{ maxWidth: 1080, width: '100%', margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 27, fontWeight: 600, color: 'var(--ink-900)', margin: '0 0 6px', letterSpacing: '-.01em' }}>
          Configure skills
        </h1>
        <p style={{ color: 'var(--ink-500)', fontSize: 15, margin: 0, maxWidth: 640, lineHeight: 1.55 }}>
          Give each fighter up to 6 skills. Every fighter needs at least one before you can fight.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            color: 'var(--ink-500)',
            padding: '0 2px',
          }}
          >
            Roster
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {session.roster.map((entry) => {
              const tmpl = snapshot.catalog.characters.find(({ id }) => id === entry.tmplId)!;
              const el = elementOf(tmpl.el);
              const selected = selectedUid === entry.uid;
              const count = (session.loadout[entry.uid] ?? []).length;
              const border = selected
                ? factionColor(entry.team)
                : (entry.team === 'B' ? 'rgba(223,109,155,.45)' : 'var(--keco-blue)');
              return (
                <div
                  key={entry.uid}
                  onClick={() => setActiveUid(entry.uid)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    background: selected
                      ? (entry.team === 'B' ? 'var(--keco-pink-wash)' : 'var(--keco-blue-soft)')
                      : '#fff',
                    border: `1.5px solid ${border}`,
                    boxShadow: selected ? 'none' : '0 1px 2px rgba(15,23,42,.04)',
                  }}
                >
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    flexShrink: 0,
                    background: el.bg,
                    color: el.c,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                  >
                    {tmpl.name[0]}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-800)' }}>{tmpl.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-450)' }}>
                      {entry.team === 'A' ? 'Team A' : 'Team B'}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: count === 0 ? 'var(--keco-danger)' : 'var(--ink-500)',
                  }}
                  >
                    {count}
                    /6
                  </span>
                </div>
              );
            })}
          </div>
          <SimulationButton
            variant="primary"
            size="large"
            disabled={!rdOk}
            onClick={onContinue}
            style={{ width: '100%', marginTop: 4 }}
          >
            Continue to Progression →
          </SimulationButton>
          <span style={{
            fontSize: 13,
            color: rdOk ? 'var(--keco-success)' : 'var(--keco-danger)',
            lineHeight: 1.4,
          }}
          >
            {rdMessage}
          </span>
        </div>

        <div style={{ background: '#fff', border: '1px solid var(--line-200)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px 10px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 10,
            }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 9,
                  flexShrink: 0,
                  background: activeEl.bg,
                  color: activeEl.c,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: 16,
                }}
                >
                  {activeTmpl.name[0]}
                </div>
                <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>
                  {activeTmpl.cls}
                  {' · '}
                  {activeRoster.team === 'A' ? 'Team A' : 'Team B'}
                </span>
              </div>
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--ink-500)',
                background: 'var(--surface-1)',
                padding: '5px 11px',
                borderRadius: 8,
                flexShrink: 0,
              }}
              >
                {equipped.length}
                {' / 6 skills'}
              </span>
            </div>
            {equipped.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {equipped.map((sid) => {
                  const skill = snapshot.catalog.skills.find((item) => item.id === sid);
                  if (!skill) return null;
                  const el = elementOf(skill.el);
                  return (
                    <span
                      key={sid}
                      onClick={() => toggle(sid)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        height: 26,
                        padding: '0 10px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: '#fff',
                        color: el.c,
                        border: `1px solid ${el.c}`,
                      }}
                      title="Remove skill"
                    >
                      {skill.el}
                      {' '}
                      <span style={{ opacity: 0.65 }}>×</span>
                    </span>
                  );
                })}
              </div>
            ) : null}
            <input
              placeholder="Search skills…"
              value={skillSearch}
              onChange={(event) => setSkillSearch(event.target.value)}
              style={{
                width: '100%',
                height: 38,
                border: '1px solid var(--line-200)',
                borderRadius: 10,
                padding: '0 12px',
                fontSize: 13,
                outline: 'none',
                fontFamily: 'var(--font-roboto)',
              }}
            />
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '36px 1.8fr .55fr .45fr .45fr .45fr',
            gap: 0,
            padding: '10px 22px',
            background: 'var(--surface-1)',
            borderTop: '1px solid var(--line-200)',
            borderBottom: '1px solid var(--line-200)',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.05em',
            color: 'var(--ink-500)',
          }}
          >
            <span />
            <span>Skill</span>
            <span>PWR</span>
            <span>MP</span>
            <span>CD</span>
            <span>Lv</span>
          </div>

          {filteredSkills.length === 0 ? (
            <div style={{ padding: '24px 22px', textAlign: 'center', fontSize: 13, color: 'var(--ink-400)' }}>
              No skills match your search.
            </div>
          ) : null}

          {filteredSkills.map((skill) => {
            const on = equipped.includes(skill.id);
            const el = elementOf(skill.el);
            const lv = activeLevels[skill.id] ?? 1;
            const full = equipped.length >= 6 && !on;
            return (
              <div
                key={skill.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1.8fr .55fr .45fr .45fr .45fr',
                  gap: 0,
                  padding: '12px 22px',
                  borderBottom: '1px solid var(--line-100)',
                  alignItems: 'center',
                  fontSize: 14,
                  color: 'var(--ink-800)',
                  cursor: full ? 'not-allowed' : 'pointer',
                  opacity: full ? 0.55 : 1,
                  background: on ? 'var(--keco-blue-soft)' : '#fff',
                }}
                onClick={() => {
                  if (!full) toggle(skill.id);
                }}
              >
                <div style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  border: `1.5px solid ${on ? 'var(--keco-blue)' : 'var(--line-300)'}`,
                  background: on ? 'var(--keco-blue)' : '#fff',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                }}
                >
                  {on ? '✓' : ''}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    flexShrink: 0,
                    background: el.bg,
                    color: el.c,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                  >
                    {skill.name[0]}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 3 }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '.04em',
                      color: el.c,
                      background: el.bg,
                      padding: '2px 7px',
                      borderRadius: 6,
                      alignSelf: 'flex-start',
                    }}
                    >
                      {skill.el}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--ink-700)', fontWeight: 500 }}>{skill.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-450)', lineHeight: 1.35 }}>{skill.fx}</span>
                  </div>
                </div>
                <span>{skillPower(skill.power, lv)}</span>
                <span>{skill.mp}</span>
                <span>{skill.cd}</span>
                <span style={{ color: on ? 'var(--keco-blue)' : 'var(--ink-600)', fontWeight: 600 }}>
                  Lv.
                  {lv}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
