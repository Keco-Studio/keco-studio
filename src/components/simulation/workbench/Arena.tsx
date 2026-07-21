import styles from './SimulationWorkbench.module.css';

export type ArenaTeam = 'A' | 'B';

export interface ArenaFighter {
  readonly uid: string;
  readonly name: string;
  readonly team: ArenaTeam;
  readonly hp: number;
  readonly maxHp: number;
  readonly effect?: string | null;
  readonly detail?: string;
  readonly active?: boolean;
}

export interface ArenaProps {
  readonly fighters: readonly ArenaFighter[];
  readonly round?: number;
  readonly caption?: string;
  readonly emptyMessage?: string;
}

function healthPercent(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  return Math.max(0, Math.min(100, (hp / maxHp) * 100));
}

export function Arena({
  fighters,
  round = 1,
  caption = 'Live combat state',
  emptyMessage = 'Assign characters to both teams to preview the arena.',
}: ArenaProps) {
  return (
    <section className={styles.arena} aria-labelledby="simulation-arena-title">
      <div className={styles.arenaHeader}>
        <div>
          <span className={styles.arenaEyebrow}>Round {round}</span>
          <h2 id="simulation-arena-title">Battle arena</h2>
        </div>
        <span className={styles.arenaCaption}>{caption}</span>
      </div>

      {fighters.length === 0 ? (
        <div className={styles.arenaEmpty}>{emptyMessage}</div>
      ) : (
        <div className={styles.battleGrid}>
          {(['A', 'B'] as const).map((team) => (
            <section key={team} className={`${styles.teamColumn} ${styles[`team${team}`]}`} aria-labelledby={`team-${team}-title`}>
              <div className={styles.teamHeader}>
                <h3 id={`team-${team}-title`}>Team {team}</h3>
                <span>{fighters.filter((fighter) => fighter.team === team && fighter.hp > 0).length} ready</span>
              </div>
              <div className={styles.fighterList}>
                {fighters.filter((fighter) => fighter.team === team).map((fighter) => {
                  const hp = Math.max(0, Math.min(fighter.hp, fighter.maxHp));
                  return (
                    <article
                      key={fighter.uid}
                      className={`${styles.fighter} ${fighter.active ? styles.fighterActive : ''} ${hp === 0 ? styles.fighterDefeated : ''}`}
                    >
                      <div className={styles.fighterIdentity}>
                        <span className={styles.fighterInitial} aria-hidden="true">{fighter.name.slice(0, 1).toUpperCase()}</span>
                        <span>
                          <strong>{fighter.name}</strong>
                          <small>{fighter.detail ?? 'Combatant'}</small>
                        </span>
                        {fighter.effect ? <span className={styles.effect}>{fighter.effect}</span> : null}
                      </div>
                      <div className={styles.healthMeta}>
                        <span>HP</span>
                        <span>{hp} / {fighter.maxHp}</span>
                      </div>
                      <div
                        className={styles.healthTrack}
                        role="progressbar"
                        aria-label={`${fighter.name} health`}
                        aria-valuenow={hp}
                        aria-valuemin={0}
                        aria-valuemax={fighter.maxHp}
                      >
                        <span className={styles.healthFill} style={{ width: `${healthPercent(hp, fighter.maxHp)}%` }} />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
