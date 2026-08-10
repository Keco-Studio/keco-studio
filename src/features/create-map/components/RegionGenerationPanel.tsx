import { DeleteOutlined, LoadingOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { RegionObstacleGenerationState } from '../hooks/useRegionObstacleGeneration';
import styles from '../CreateMapWorkbench.module.css';

type RegionGenerationPanelProps = RegionObstacleGenerationState & {
  onClearSelection: () => void;
};

const phaseLabel: Record<RegionObstacleGenerationState['phase'], string> = {
  empty: 'Select a map region',
  'prompt-ready': 'Ready to generate',
  submitting: 'Creating asset plan',
  generating: 'Generating obstacle',
  failed: 'Generation failed',
  ready: 'Obstacle added to Scene',
};

export function RegionGenerationPanel({
  selection,
  prompt,
  phase,
  error,
  asset,
  setPrompt,
  generate,
  onClearSelection,
}: RegionGenerationPanelProps) {
  const busy = phase === 'submitting' || phase === 'generating';
  return (
    <section className={styles.inspectorSection} aria-labelledby="region-generation-heading">
      <div className={styles.sectionHeadingRow}>
        <h2 id="region-generation-heading" className={styles.sectionTitleSmall}>Generate obstacle</h2>
        <span className={styles.generationStatus}>{phaseLabel[phase]}</span>
      </div>
      {selection ? (
        <div className={styles.selectionReadout}>
          <span>Region</span>
          <strong>{Math.round(selection.width)} x {Math.round(selection.height)} px</strong>
          <button type="button" className={styles.miniIconButton} aria-label="Clear region selection" title="Clear selection" onClick={onClearSelection} disabled={busy}>
            <DeleteOutlined />
          </button>
        </div>
      ) : (
        <p className={styles.emptyState}>Drag a rectangle on the Scene canvas first.</p>
      )}
      <label className={styles.fieldLabel}>
        Description
        <textarea
          className={styles.textarea}
          value={prompt}
          disabled={!selection || busy}
          placeholder="A mossy stone shrine with a low footprint"
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <button
        type="button"
        className={styles.primaryButton}
        disabled={!selection || !prompt.trim() || busy || phase === 'ready'}
        onClick={() => void generate()}
      >
        {busy ? <LoadingOutlined aria-hidden /> : phase === 'failed' ? <ReloadOutlined aria-hidden /> : <ThunderboltOutlined aria-hidden />}
        {busy ? 'Generating' : phase === 'failed' ? 'Retry obstacle' : phase === 'ready' ? 'Obstacle added' : 'Generate obstacle'}
      </button>
      {asset?.signedUrl === null && phase === 'ready' ? <p className={styles.inspectorNote}>Ready asset saved. Preview URL unavailable.</p> : null}
      {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
    </section>
  );
}
