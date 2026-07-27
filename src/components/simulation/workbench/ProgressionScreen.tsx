'use client';

import { useState } from 'react';
import { EL, levelRule, needExp, skillCost, skillDef, skillPower } from '@/lib/simulation/data';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import type { ElementName } from '@/lib/simulation/types';
import { SimulationButton } from './SimulationButton';

function elementOf(el: string) {
  return EL[(el in EL ? el : 'Physical') as ElementName];
}

const factionColor = (team: 'A' | 'B') => (team === 'A' ? 'var(--keco-blue)' : 'var(--keco-pink-strong)');

function Stepper({
  value,
  onInc,
  onDec,
  canInc = true,
  canDec = true,
  accent,
}: {
  value: number;
  onInc: () => void;
  onDec: () => void;
  canInc?: boolean;
  canDec?: boolean;
  accent?: string;
}) {
  const btn = (disabled: boolean) => ({
    width: 22,
    height: 18,
    border: '1px solid var(--line-200)',
    borderRadius: 4,
    background: disabled ? 'var(--surface-1)' : '#fff',
    color: disabled ? 'var(--ink-350)' : 'var(--ink-600)',
    cursor: disabled ? 'not-allowed' as const : 'pointer' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    lineHeight: 1,
    padding: 0,
    userSelect: 'none' as const,
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || 'var(--ink-900)', minWidth: 28 }}>{value}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={btn(!canInc)} onClick={() => { if (canInc) onInc(); }}>▲</div>
        <div style={btn(!canDec)} onClick={() => { if (canDec) onDec(); }}>▼</div>
      </div>
    </div>
  );
}

export function ProgressionScreen({ onContinue }: { onContinue: () => void }) {
  const { activeSession, updateSkills, updateProgression } = useSimulationSession();
  const [activeUid, setActiveUid] = useState<string | null>(null);
  const session = activeSession;
  const snapshot = session?.importedSnapshot;
  const uid = activeUid && session?.roster.some((entry) => entry.uid === activeUid)
    ? activeUid
    : session?.roster[0]?.uid ?? null;

  if (!session || !snapshot || !uid) {
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
        Configure characters and skills first.
      </div>
    );
  }

  const entry = session.roster.find((item) => item.uid === uid)!;
  const character = snapshot.catalog.characters.find(({ id }) => id === entry.tmplId)!;
  const charEl = elementOf(character.el);
  const exp = session.progression.exp[uid] ?? 0;
  const level = session.progression.lv[uid] ?? 1;
  const points = session.progression.sp[uid] ?? 2;
  const equipped = session.loadout[uid] ?? [];
  const levels = session.skillLevels[uid] ?? {};
  const expNeed = needExp(level, snapshot.levelRules, character.id);
  const applicableLevelRules = snapshot.levelRules.filter((rule) => (
    !rule.characterId || rule.characterId === character.id
  ));
  const maxLevel = Math.max(1, ...applicableLevelRules.map((rule) => rule.level));

  function upgrade(skillId: string) {
    const current = levels[skillId] ?? 1;
    const cost = skillCost(current, snapshot!.skillCostRules, skillId);
    if (cost === null || points < cost) return;
    updateSkills(session!.id, uid!, equipped, { ...levels, [skillId]: current + 1 });
    updateProgression(session!.id, uid!, exp, level, points - cost);
  }

  function reset(skillId: string) {
    const current = levels[skillId] ?? 1;
    let refund = 0;
    for (let lv = 1; lv < current; lv += 1) {
      const cost = skillCost(lv, snapshot!.skillCostRules, skillId);
      if (cost === null) return;
      refund += cost;
    }
    updateSkills(session!.id, uid!, equipped, { ...levels, [skillId]: 1 });
    updateProgression(session!.id, uid!, exp, level, points + refund);
  }

  function setLevel(delta: number) {
    const next = Math.max(1, Math.min(maxLevel, level + delta));
    if (next === level) return;
    let spDelta = 0;
    if (next > level) {
      for (let from = level; from < next; from += 1) {
        spDelta += levelRule(from, snapshot!.levelRules, character.id)?.sp ?? 0;
      }
    } else {
      for (let from = next; from < level; from += 1) {
        spDelta -= levelRule(from, snapshot!.levelRules, character.id)?.sp ?? 0;
      }
    }
    updateProgression(session!.id, uid!, exp, next, Math.max(0, points + spDelta));
  }

  function setSp(delta: number) {
    const next = Math.max(0, points + delta);
    updateProgression(session!.id, uid!, exp, level, next);
  }

  return (
    <div style={{ maxWidth: 1080, width: '100%', margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 27, fontWeight: 600, color: 'var(--ink-900)', margin: '0 0 6px', letterSpacing: '-.01em' }}>
          Progression
        </h1>
        <p style={{ color: 'var(--ink-500)', fontSize: 15, margin: 0, maxWidth: 660, lineHeight: 1.55 }}>
          Spend <b>SP</b> to level skills. Win battles to earn EXP. Saved per user — never written back to Studio.
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
            {session.roster.map((item) => {
              const tmpl = snapshot.catalog.characters.find(({ id }) => id === item.tmplId)!;
              const el = elementOf(tmpl.el);
              const sel = uid === item.uid;
              const cnt = (session.loadout[item.uid] ?? []).length;
              const border = sel
                ? factionColor(item.team)
                : (item.team === 'B' ? 'rgba(223,109,155,.45)' : 'var(--keco-blue)');
              return (
                <div
                  key={item.uid}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    background: sel
                      ? (item.team === 'B' ? 'var(--keco-pink-wash)' : 'var(--keco-blue-soft)')
                      : '#fff',
                    border: `1.5px solid ${border}`,
                  }}
                  onClick={() => setActiveUid(item.uid)}
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
                      {item.team === 'A' ? 'Team A' : 'Team B'}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-500)' }}>
                    {cnt}
                    /6
                  </span>
                </div>
              );
            })}
          </div>
          <SimulationButton variant="primary" size="large" onClick={onContinue} style={{ width: '100%' }}>
            Go to Battle →
          </SimulationButton>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>
          <div style={{ background: '#fff', border: '1px solid var(--line-200)', borderRadius: 14, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 9,
                flexShrink: 0,
                background: charEl.bg,
                color: charEl.c,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 18,
                border: `2px solid ${factionColor(entry.team)}`,
              }}
              >
                {character.name[0]}
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink-900)' }}>{character.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-450)' }}>
                  {character.cls}
                  {' · '}
                  {entry.team === 'A' ? 'Team A' : 'Team B'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, background: 'var(--keco-blue-tint)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{
                  fontSize: 11,
                  color: 'var(--ink-500)',
                  textTransform: 'uppercase',
                  letterSpacing: '.04em',
                  marginBottom: 4,
                }}
                >
                  Level
                </div>
                <Stepper
                  value={level}
                  canInc={level < maxLevel && expNeed !== null}
                  canDec={level > 1}
                  onInc={() => setLevel(1)}
                  onDec={() => setLevel(-1)}
                />
              </div>
              <div style={{ flex: 1, background: 'var(--keco-purple-tint)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{
                  fontSize: 11,
                  color: 'var(--ink-500)',
                  textTransform: 'uppercase',
                  letterSpacing: '.04em',
                  marginBottom: 4,
                }}
                >
                  Skill points
                </div>
                <Stepper
                  value={points}
                  accent="var(--keco-purple)"
                  canDec={points > 0}
                  onInc={() => setSp(1)}
                  onDec={() => setSp(-1)}
                />
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'var(--ink-500)',
                marginBottom: 5,
              }}
              >
                <span>EXP</span>
                <span>{level >= maxLevel ? 'Max level' : (expNeed === null ? 'Rule missing' : `${exp} / ${expNeed}`)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 5, background: 'var(--line-100)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${level >= maxLevel ? 100 : (expNeed === null ? 0 : Math.min(100, (exp / expNeed) * 100))}%`,
                  background: 'var(--keco-blue)',
                  borderRadius: 5,
                  transition: 'width .3s',
                }}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {([['HP', character.hp], ['ATK', character.atk], ['DEF', character.def], ['SPD', character.spd], ['MP', character.mp]] as const).map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '7px 10px',
                    background: 'var(--surface-1)',
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: 'var(--ink-500)' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: 'var(--ink-800)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--line-200)', borderRadius: 14, padding: '20px 22px' }}>
            <div style={{
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
              color: 'var(--ink-500)',
              marginBottom: 14,
            }}
            >
              Equipped skills
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {equipped.map((skillId) => {
                const skill = skillDef(skillId, snapshot.catalog);
                const el = elementOf(skill.el);
                const skillLevel = levels[skillId] ?? 1;
                const cost = skillCost(skillLevel, snapshot.skillCostRules, skillId);
                const applicableCosts = snapshot.skillCostRules.filter((rule) => (
                  !rule.skillId || rule.skillId === skillId
                ));
                const ruleMissing = cost === null && applicableCosts.some((rule) => rule.lv > skillLevel);
                const isMax = cost === null && !ruleMissing;
                const maxSkillLevel = applicableCosts.length
                  ? Math.max(...applicableCosts.map((rule) => rule.lv)) + 1
                  : Math.max(skillLevel, 1);
                const can = cost !== null && points >= cost;
                const canReset = Array.from({ length: Math.max(0, skillLevel - 1) }, (_, index) => (
                  skillCost(index + 1, snapshot.skillCostRules, skillId)
                )).every((value) => value !== null);
                return (
                  <div
                    key={skillId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '13px 15px',
                      border: '1px solid var(--line-200)',
                      borderRadius: 11,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' }}>{skill.name}</span>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '.04em',
                          color: el.c,
                          background: el.bg,
                          padding: '2px 7px',
                          borderRadius: 6,
                        }}
                        >
                          {skill.el}
                        </span>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 12,
                          color: 'var(--ink-500)',
                          marginBottom: 5,
                        }}
                        >
                          <span>Skill level</span>
                          <span>{ruleMissing ? 'Rule missing' : (isMax ? 'Max' : `Lv.${skillLevel}`)}</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 5, background: 'var(--line-100)', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            width: `${(skillLevel / maxSkillLevel) * 100}%`,
                            background: factionColor(entry.team),
                            borderRadius: 5,
                            transition: 'width .3s',
                          }}
                          />
                        </div>
                        <span style={{
                          fontSize: 12,
                          color: 'var(--ink-450)',
                          marginTop: 5,
                          display: 'inline-block',
                        }}
                        >
                          PWR
                          {' '}
                          {skillPower(skill.power, skillLevel)}
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        padding: '7px 13px',
                        borderRadius: 9,
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        cursor: cost === null ? 'default' : (can ? 'pointer' : 'not-allowed'),
                        background: cost === null ? '#EEF1F5' : (can ? 'var(--keco-blue)' : '#EEF1F5'),
                        color: cost === null ? 'var(--ink-450)' : (can ? '#fff' : 'var(--ink-350)'),
                        border: '1px solid transparent',
                      }}
                      onClick={() => {
                        if (cost !== null) upgrade(skillId);
                      }}
                    >
                      {ruleMissing ? 'Rule missing' : (isMax ? 'Max' : `+1 · ${cost} SP`)}
                    </div>
                    {skillLevel > 1 && canReset ? (
                      <div
                        style={{ fontSize: 12, color: 'var(--ink-400)', cursor: 'pointer', padding: '6px 4px' }}
                        onClick={() => reset(skillId)}
                      >
                        Reset
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
