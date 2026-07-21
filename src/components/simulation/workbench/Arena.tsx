import { EL } from '@/lib/simulation/data';
import type { ElementName } from '@/lib/simulation/types';

export type ArenaTeam = 'A' | 'B';

export interface ArenaFighter {
  readonly uid: string;
  readonly name: string;
  readonly team: ArenaTeam;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly maxMp: number;
  readonly el?: ElementName | string;
  readonly initial?: string;
  readonly alive?: boolean;
  readonly effect?: string | null;
  readonly detail?: string;
  readonly active?: boolean;
  readonly hit?: boolean;
  readonly feedback?: {
    readonly key: number;
    readonly value: string;
    readonly tone: 'damage' | 'heal';
  } | null;
}

export interface ArenaProps {
  readonly fighters: readonly ArenaFighter[];
  readonly round?: number;
  readonly caption?: string;
  readonly emptyMessage?: string;
}

function elementOf(el: string | undefined) {
  const key = (el && el in EL ? el : 'Physical') as ElementName;
  return EL[key];
}

function Token({
  fighter,
  side,
}: {
  fighter: ArenaFighter;
  side: ArenaTeam;
}) {
  const el = elementOf(fighter.el ?? fighter.detail);
  const dead = fighter.alive === false || fighter.hp <= 0;
  const acting = Boolean(fighter.active);
  const hit = Boolean(fighter.hit);
  const lunge = acting ? (side === 'A' ? 'translateX(26px)' : 'translateX(-26px)') : 'translateX(0)';
  const float = fighter.feedback;

  return (
    <div
      style={{
        position: 'relative',
        width: 186,
        transition: 'transform .28s var(--ease)',
        transform: `${lunge}${hit ? ` translateX(${side === 'A' ? '6px' : '-6px'})` : ''}`,
        opacity: dead ? 0.32 : 1,
        filter: dead ? 'grayscale(1)' : 'none',
      }}
    >
      {float ? (
        <div
          key={float.key}
          style={{
            position: 'absolute',
            top: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            fontWeight: 800,
            fontSize: 20,
            color: float.tone === 'heal' ? '#10B981' : '#EF4444',
            animation: 'kFloat 1s ease-out forwards',
            pointerEvents: 'none',
            zIndex: 5,
            textShadow: '0 1px 2px rgba(255,255,255,.9)',
          }}
        >
          {float.value}
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: '#fff',
          border: `2px solid ${side === 'A' ? 'var(--keco-blue)' : 'var(--keco-pink-strong)'}`,
          borderRadius: 12,
          padding: '10px 12px',
          boxShadow: acting ? '0 6px 18px rgba(11,153,255,.28)' : 'var(--shadow-card-hover)',
        }}
      >
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          flexShrink: 0,
          background: el.bg,
          color: el.c,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: 18,
        }}
        >
          {fighter.initial ?? fighter.name.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-900)' }}>{fighter.name}</span>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              color: el.c,
              textTransform: 'uppercase',
              letterSpacing: '.04em',
            }}
            >
              {fighter.el ?? 'Physical'}
            </span>
          </div>
          <div style={{
            height: 7,
            borderRadius: 4,
            background: '#EEF1F5',
            overflow: 'hidden',
            margin: '6px 0 3px',
          }}
          >
            <div style={{
              height: '100%',
              width: `${Math.max(0, (fighter.hp / Math.max(1, fighter.maxHp)) * 100)}%`,
              background: fighter.hp / Math.max(1, fighter.maxHp) < 0.3 ? '#EF4444' : '#10B981',
              transition: 'width .3s var(--ease)',
            }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-450)' }}>
            <span>
              HP
              {' '}
              {fighter.hp}
            </span>
            <span>
              MP
              {' '}
              {fighter.mp}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Column({
  list,
  side,
}: {
  list: readonly ArenaFighter[];
  side: ArenaTeam;
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      justifyContent: 'center',
      alignItems: side === 'A' ? 'flex-start' : 'flex-end',
      flex: 1,
    }}
    >
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '.06em',
        color: side === 'A' ? 'var(--keco-blue)' : 'var(--keco-pink-strong)',
        padding: side === 'A' ? '0 0 2px 4px' : '0 4px 2px 0',
      }}
      >
        {side === 'A' ? 'Team A · You' : 'Team B · Enemy'}
      </div>
      {list.map((fighter) => (
        <Token key={fighter.uid} fighter={fighter} side={side} />
      ))}
    </div>
  );
}

export function Arena({
  fighters,
  emptyMessage = 'Assign characters to both teams to preview the arena.',
}: ArenaProps) {
  const teamA = fighters.filter((fighter) => fighter.team === 'A');
  const teamB = fighters.filter((fighter) => fighter.team === 'B');

  if (fighters.length === 0) {
    return (
      <div style={{
        position: 'relative',
        height: '100%',
        minHeight: 260,
        borderRadius: 16,
        overflow: 'hidden',
        border: '1px solid var(--line-200)',
        background: 'radial-gradient(120% 120% at 50% 0%, #F4F8FC 0%, #EAEFF6 60%, #E4EAF3 100%)',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--ink-500)',
        textAlign: 'center',
        padding: 24,
      }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{
      position: 'relative',
      height: '100%',
      minHeight: 320,
      borderRadius: 16,
      overflow: 'hidden',
      border: '1px solid var(--line-200)',
      background: 'radial-gradient(120% 120% at 50% 0%, #F4F8FC 0%, #EAEFF6 60%, #E4EAF3 100%)',
    }}
    >
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'linear-gradient(rgba(148,163,184,.14) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.14) 1px,transparent 1px)',
        backgroundSize: '38px 38px',
      }}
      />
      <div style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: '50%',
        width: 1,
        background: 'rgba(148,163,184,.35)',
      }}
      />
      <div style={{
        position: 'relative',
        display: 'flex',
        height: '100%',
        alignItems: 'stretch',
        padding: '22px 26px',
        gap: 20,
      }}
      >
        <Column list={teamA} side="A" />
        <div style={{
          alignSelf: 'center',
          fontFamily: 'var(--font-koulen)',
          fontSize: 26,
          color: 'var(--ink-350)',
          letterSpacing: '.05em',
        }}
        >
          VS
        </div>
        <Column list={teamB} side="B" />
      </div>
    </div>
  );
}
