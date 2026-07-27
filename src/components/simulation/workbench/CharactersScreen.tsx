'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createCharSnapshot, EL, sortRosterByTeam } from '@/lib/simulation/data';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import type { ElementName, Team } from '@/lib/simulation/types';
import { SimulationButton } from './SimulationButton';
import styles from './SimulationWorkbench.module.css';

const SNAPSHOT_NOTE = 'Studio snapshot — original character data from import; unaffected by progression.';

function elementStyle(el: ElementName | string | undefined) {
  return EL[(el as ElementName) in EL ? (el as ElementName) : 'Physical'];
}

function TeamSelect({
  value,
  onChange,
  open,
  onOpenChange,
}: {
  value: Team;
  onChange: (team: Team) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const isA = value === 'A';

  useEffect(() => {
    if (!open) return;
    function handle(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onOpenChange(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open, onOpenChange]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 32,
          padding: '0 12px',
          borderRadius: 8,
          border: 'none',
          background: isA ? 'var(--keco-blue-tint)' : 'var(--keco-pink-wash)',
          color: isA ? 'var(--keco-blue)' : 'var(--keco-pink-strong)',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'var(--font-roboto)',
          cursor: 'pointer',
        }}
      >
        {isA ? 'Team A' : 'Team B'}
        <span style={{ fontSize: 10, opacity: 0.8 }}>▾</span>
      </button>
      {open ? (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 'calc(100% + 6px)',
          zIndex: 40,
          width: 128,
          background: '#fff',
          border: '1px solid var(--line-200)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-popover)',
          padding: 4,
        }}
        >
          {(['A', 'B'] as const).map((team) => (
            <div
              key={team}
              onClick={() => {
                onChange(team);
                onOpenChange(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                color: team === 'A' ? 'var(--keco-blue)' : 'var(--keco-pink-strong)',
                background: value === team
                  ? (team === 'A' ? 'var(--keco-blue-tint)' : 'var(--keco-pink-wash)')
                  : 'transparent',
              }}
            >
              Team {team}
              <span style={{ opacity: value === team ? 1 : 0 }}>✓</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CharactersScreen({ onContinue }: { onContinue: () => void }) {
  const { activeSession, updateRoster } = useSimulationSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [teamMenuUid, setTeamMenuUid] = useState<string | null>(null);
  const [flashUid, setFlashUid] = useState<string | null>(null);
  const [hoverUid, setHoverUid] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const prevTops = useRef<Record<string, number>>({});
  const snapshot = activeSession?.importedSnapshot ?? null;
  const roster = useMemo(() => activeSession?.roster ?? [], [activeSession]);
  const filtered = (snapshot?.catalog.characters ?? []).filter((character) =>
    (character.name + ' ' + (character.cls ?? '')).toLowerCase().includes(search.toLowerCase()));
  const counts = {
    A: roster.filter(({ team }) => team === 'A').length,
    B: roster.filter(({ team }) => team === 'B').length,
  };
  const charsReady = counts.A > 0 && counts.B > 0;

  useLayoutEffect(() => {
    roster.forEach((entry) => {
      const el = rowRefs.current[entry.uid];
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const prev = prevTops.current[entry.uid];
      if (prev !== undefined && Math.abs(prev - top) > 1) {
        const dy = prev - top;
        el.style.transform = `translateY(${dy}px)`;
        el.style.transition = 'none';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)';
            el.style.transform = '';
          });
        });
      }
      prevTops.current[entry.uid] = top;
    });
  }, [roster]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  function toggle(tmplId: string) {
    if (!activeSession || !snapshot) return;
    const current = roster.find((entry) => entry.tmplId === tmplId);
    if (current) {
      updateRoster(activeSession.id, roster.filter(({ uid }) => uid !== current.uid));
      return;
    }
    const team: Team = counts.A <= counts.B ? 'A' : 'B';
    const uid = tmplId + '-' + crypto.randomUUID();
    updateRoster(
      activeSession.id,
      sortRosterByTeam(
        [...roster, { uid, tmplId, team, snapshot: createCharSnapshot(tmplId, snapshot.catalog) }],
        snapshot.catalog,
      ),
    );
  }

  function setTeam(uid: string, team: Team) {
    if (!activeSession || !snapshot) return;
    updateRoster(
      activeSession.id,
      sortRosterByTeam(
        roster.map((entry) => (entry.uid === uid ? { ...entry, team } : entry)),
        snapshot.catalog,
      ),
    );
  }

  function handleSetTeam(uid: string, team: Team) {
    const current = roster.find((entry) => entry.uid === uid);
    if (current && current.team === team) return;
    setFlashUid(uid);
    setTimeout(() => setFlashUid(null), 500);
    setTeam(uid, team);
  }

  if (!activeSession || !snapshot) {
    return <div className={styles.emptyState}>Import Studio libraries first.</div>;
  }

  return (
    <div style={{ maxWidth: 1000, width: '100%', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 27, fontWeight: 600, color: 'var(--ink-900)', margin: '0 0 6px', letterSpacing: '-.01em' }}>
            Configure characters
          </h1>
          <p style={{ color: 'var(--ink-500)', fontSize: 15, margin: 0, maxWidth: 620, lineHeight: 1.55 }}>
            Pick the fighters that take the field and split them into Team A and Team B.
          </p>
        </div>
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 40,
              padding: '0 16px',
              borderRadius: 10,
              background: 'var(--keco-blue-soft)',
              color: 'var(--keco-blue)',
              fontSize: 14,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-roboto)',
            }}
            onClick={() => {
              setMenuOpen(!menuOpen);
              setSearch('');
              setTeamMenuUid(null);
            }}
          >
            + Add characters
          </button>
          {menuOpen ? (
            <div style={{
              position: 'absolute',
              zIndex: 30,
              right: 0,
              top: 48,
              width: 320,
              background: '#fff',
              border: '1px solid var(--line-200)',
              borderRadius: 12,
              boxShadow: 'var(--shadow-popover)',
              padding: 8,
            }}
            >
              <input
                placeholder="Search characters…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={{
                  width: '100%',
                  height: 36,
                  border: '1px solid var(--line-200)',
                  borderRadius: 8,
                  padding: '0 12px',
                  fontSize: 13,
                  outline: 'none',
                  fontFamily: 'var(--font-roboto)',
                  marginBottom: 6,
                }}
              />
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                {filtered.map((character) => {
                  const inRoster = roster.some((entry) => entry.tmplId === character.id);
                  const el = elementStyle(character.el);
                  return (
                    <div
                      key={character.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 8px',
                        borderRadius: 9,
                        cursor: 'pointer',
                        background: inRoster ? 'var(--keco-blue-tint)' : 'transparent',
                      }}
                      onClick={() => toggle(character.id)}
                    >
                      <div style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
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
                        {character.name[0]}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-800)' }}>{character.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink-450)' }}>{character.cls}</span>
                      </div>
                      <span style={{ color: 'var(--keco-blue)', fontSize: 13, opacity: inRoster ? 1 : 0 }}>✓</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {roster.length === 0 ? (
        <div style={{
          border: '1.5px dashed var(--line-300)',
          borderRadius: 14,
          padding: 56,
          textAlign: 'center',
          color: 'var(--ink-400)',
          background: '#fff',
        }}
        >
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-500)', marginBottom: 4 }}>No characters yet</div>
          <div style={{ fontSize: 13 }}>
            Use <b>Add characters</b> to pull fighters from the Characters library.
          </div>
        </div>
      ) : null}

      {roster.length > 0 ? (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            {[
              { key: 'A', label: 'Team A', count: counts.A, color: 'var(--keco-blue)' },
              { key: 'B', label: 'Team B', count: counts.B, color: 'var(--keco-pink-strong)' },
            ].map((card) => (
              <div
                key={card.key}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: '18px 20px',
                  borderRadius: 12,
                  background: '#fff',
                  border: '1px solid var(--line-200)',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  fontWeight: 600,
                  color: card.color,
                  lineHeight: 1.2,
                }}
                >
                  {card.label}
                </span>
                <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1 }}>{card.count}</span>
              </div>
            ))}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            marginBottom: 12,
            background: 'var(--keco-blue)',
            borderRadius: 10,
          }}
          >
            <span style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              flexShrink: 0,
              border: '1.5px solid rgba(255,255,255,.85)',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
            }}
            >
              i
            </span>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#fff', lineHeight: 1.45, margin: 0 }}>{SNAPSHOT_NOTE}</p>
          </div>

          <div style={{ background: '#fff', border: '1px solid var(--line-200)', borderRadius: 14, overflow: 'visible' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1.7fr .55fr repeat(5,.65fr) 1.35fr',
              gap: 0,
              padding: '12px 20px',
              background: 'var(--surface-1)',
              borderBottom: '1px solid var(--line-200)',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
              color: 'var(--ink-500)',
            }}
            >
              <span>Character</span>
              <span>Lv</span>
              <span>HP</span>
              <span>ATK</span>
              <span>DEF</span>
              <span>SPD</span>
              <span>MP</span>
              <span style={{ textAlign: 'right' }}>Team</span>
            </div>
            {roster.map((entry, idx) => {
              const character = snapshot.catalog.characters.find(({ id }) => id === entry.tmplId)!;
              const snap = entry.snapshot;
              const el = elementStyle(snap?.el ?? character.el);
              const teamOpen = teamMenuUid === entry.uid;
              const isHovered = hoverUid === entry.uid;
              const isLast = idx === roster.length - 1;
              return (
                <div
                  key={entry.uid}
                  ref={(node) => { rowRefs.current[entry.uid] = node; }}
                  onMouseEnter={() => setHoverUid(entry.uid)}
                  onMouseLeave={() => setHoverUid((current) => (current === entry.uid ? null : current))}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.7fr .55fr repeat(5,.65fr) 1.35fr',
                    gap: 0,
                    padding: '12px 20px',
                    borderBottom: isLast ? 'none' : '1px solid var(--line-100)',
                    alignItems: 'center',
                    fontSize: 14,
                    color: 'var(--ink-800)',
                    position: 'relative',
                    zIndex: teamOpen ? 30 : 1,
                    background: isHovered ? 'var(--keco-blue-soft)' : 'transparent',
                    transition: 'background .15s ease',
                    animation: flashUid === entry.uid ? 'kRosterFlash 0.5s ease' : 'none',
                  }}
                >
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
                      fontSize: 15,
                    }}
                    >
                      {(snap?.name ?? character.name)[0]}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600 }}>{snap?.name ?? character.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-450)' }}>{snap?.cls ?? character.cls}</span>
                    </div>
                  </div>
                  <span style={{ color: 'var(--ink-500)' }}>{snap?.lv ?? 1}</span>
                  <span>{snap?.hp ?? character.hp}</span>
                  <span>{snap?.atk ?? character.atk}</span>
                  <span>{snap?.def ?? character.def}</span>
                  <span>{snap?.spd ?? character.spd}</span>
                  <span>{snap?.mp ?? character.mp}</span>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <TeamSelect
                      value={entry.team}
                      open={teamOpen}
                      onOpenChange={(next) => setTeamMenuUid(next ? entry.uid : null)}
                      onChange={(team) => handleSetTeam(entry.uid, team)}
                    />
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => toggle(entry.tmplId)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--keco-danger)',
                        cursor: 'pointer',
                        fontSize: 15,
                        lineHeight: 1,
                        opacity: isHovered ? 1 : 0,
                        pointerEvents: isHovered ? 'auto' : 'none',
                        transition: 'opacity .15s ease',
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 22 }}>
            <SimulationButton variant="primary" size="large" disabled={!charsReady} onClick={onContinue}>
              Confirm &amp; go to skill
            </SimulationButton>
            <span style={{ fontSize: 13, color: charsReady ? 'var(--ink-600)' : 'var(--keco-danger)' }}>
              {charsReady ? `A ${counts.A} vs B ${counts.B} — ready` : 'Assign at least one fighter to each team'}
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
