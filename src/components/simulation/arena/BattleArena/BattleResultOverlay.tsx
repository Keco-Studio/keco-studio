'use client';

import styles from './BattleResultOverlay.module.css';

export type BattleResultOutcome = 'win' | 'lose' | 'fled';

export type BattleResultOverlayProps = {
  open: boolean;
  outcome: BattleResultOutcome | null;
  enemyName: string;
  onContinue: () => void;
  onBattleAgain: () => void;
  /** e.g. "+70 EXP to Team A · 1 level-up" */
  rewardSummaryLines?: string[];
  /** Optional: import this battle's events into the progression simulator. */
  onImportProgression?: () => void;
};

function winnerFromOutcome(outcome: BattleResultOutcome): 'A' | 'B' | null {
  if (outcome === 'win') return 'A';
  if (outcome === 'lose') return 'B';
  return null;
}

export function BattleResultOverlay({
  open,
  outcome,
  enemyName,
  onContinue,
  onBattleAgain,
  rewardSummaryLines,
  onImportProgression,
}: BattleResultOverlayProps) {
  if (!open || !outcome) return null;

  const winner = winnerFromOutcome(outcome);
  const isFled = outcome === 'fled';
  const winnerLabel = winner === 'A' ? 'Team A' : winner === 'B' ? 'Team B' : null;
  const title = isFled ? 'ESCAPED' : winnerLabel ? `${winnerLabel.toUpperCase()} WINS` : 'DRAW';
  const titleTone = winner === 'A' ? styles.titleTeamA : winner === 'B' ? styles.titleTeamB : styles.titleNeutral;
  const rewardLine = rewardSummaryLines?.filter(Boolean).join(' · ') ?? null;

  return (
    <div className={styles.root} role="dialog" aria-modal aria-labelledby="battle-result-title">
      <div className={styles.backdrop} aria-hidden />
      <div className={styles.panel}>
        <h2 id="battle-result-title" className={`${styles.title} ${titleTone}`}>
          {title}
        </h2>

        {rewardLine ? (
          <p className={styles.reward}>{rewardLine}</p>
        ) : (
          <p className={styles.reward}>
            {isFled
              ? 'No EXP awarded.'
              : winnerLabel
                ? `Victory for ${winnerLabel}.`
                : 'Battle ended.'}
            {enemyName && winner === 'A' ? ` Defeated ${enemyName}.` : null}
          </p>
        )}

        <div className={styles.actions}>
          {onImportProgression ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={onImportProgression}
            >
              Import battle contributions
            </button>
          ) : null}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={onBattleAgain}
          >
            Battle again
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onContinue}
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
