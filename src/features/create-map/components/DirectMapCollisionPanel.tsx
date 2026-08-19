import { DeleteOutlined, EditOutlined, EyeInvisibleOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { countCollisionCells, type DirectMapCollisionCell, type DirectMapCollisionGrid } from '../model/directMapCollisionGrid';
import type { DirectMapCollisionPhase } from '../hooks/useDirectMapCollisionGrid';
import styles from '../CreateMapWorkbench.module.css';

const PHASE_LABELS: Record<DirectMapCollisionPhase, string> = {
  idle: 'Waiting for image',
  analyzing: 'Analyzing map',
  ready: 'Grid ready',
  failed: 'Analysis failed',
};

export function DirectMapCollisionPanel({
  grid,
  phase,
  error,
  overlayVisible,
  paintMode,
  onOverlayVisibleChange,
  onPaintModeChange,
  onRetry,
  onClear,
  readOnly = false,
}: {
  grid: DirectMapCollisionGrid | null;
  phase: DirectMapCollisionPhase;
  error: string | null;
  overlayVisible: boolean;
  paintMode: DirectMapCollisionCell;
  onOverlayVisibleChange: (visible: boolean) => void;
  onPaintModeChange: (mode: DirectMapCollisionCell) => void;
  onRetry: () => void;
  onClear: () => void;
  readOnly?: boolean;
}) {
  const counts = grid ? countCollisionCells(grid) : null;
  return (
    <section className={styles.inspectorSection} aria-labelledby="direct-collision-heading">
      <div className={styles.sectionHeadingRow}>
        <div>
          <span className={styles.eyebrow}>8 px cells</span>
          <h2 id="direct-collision-heading" className={styles.sectionTitleSmall}>Collision</h2>
        </div>
        <span className={styles.generationPhase} data-phase={phase}>{PHASE_LABELS[phase]}</span>
      </div>

      {grid ? (
        <>
          <div className={styles.collisionSummary} aria-label="Collision cell counts">
            <span><i data-cell="walkable" />{counts?.[0]} walkable</span>
            <span><i data-cell="blocked" />{counts?.[1]} blocked</span>
          </div>
          <div className={styles.collisionModes} role="group" aria-label="Collision paint mode">
            {([
              [0, 'Walkable'],
              [1, 'Obstacle'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={paintMode === value ? styles.collisionModeActive : styles.collisionMode}
                aria-pressed={paintMode === value}
                disabled={readOnly}
                onClick={() => onPaintModeChange(value)}
              >
                <span data-cell={value} />{label}
              </button>
            ))}
          </div>
          <div className={styles.collisionActions}>
            <button type="button" disabled={readOnly} title={overlayVisible ? 'Hide collision overlay' : 'Show collision overlay'} onClick={() => onOverlayVisibleChange(!overlayVisible)}>
              {overlayVisible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              {overlayVisible ? 'Hide' : 'Show'}
            </button>
            <button type="button" disabled={readOnly} title="Clear all collision cells" onClick={onClear}><DeleteOutlined /> Clear</button>
          </div>
          <button type="button" className={styles.secondaryButtonFull} disabled={readOnly} onClick={onRetry}>
            <ReloadOutlined /> Re-analyze with AI
          </button>
        </>
      ) : null}

      {phase === 'analyzing' ? <div className={styles.generationProgress} aria-label="Analyzing map collision"><span /></div> : null}
      {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
      {phase === 'failed' ? (
        <div className={styles.collisionActions}>
          <button type="button" disabled={readOnly} onClick={onRetry}>
            <ReloadOutlined /> Retry analysis
          </button>
          <button type="button" disabled={readOnly} onClick={onClear}>
            <EditOutlined /> Edit manually
          </button>
        </div>
      ) : null}
    </section>
  );
}
