import { CheckCircleOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type {
  DirectMapGenerationAsset,
  DirectMapGenerationPhase,
} from '../hooks/useDirectMapGeneration';
import styles from '../CreateMapWorkbench.module.css';

type DirectMapGenerationPanelProps = {
  phase: DirectMapGenerationPhase;
  asset: DirectMapGenerationAsset | null;
  error: string | null;
  canPrepare: boolean;
  canRetry: boolean;
  onPrepare: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onRegenerate: () => void;
};

const PHASE_LABELS: Record<DirectMapGenerationPhase, string> = {
  idle: 'Not prepared',
  preparing: 'Preparing revision',
  'awaiting-confirmation': 'Awaiting confirmation',
  submitting: 'Submitting request',
  generating: 'Generating map',
  validating: 'Validating image',
  ready: 'Map ready',
  failed: 'Generation failed',
  blocked: 'Generation blocked',
};

export function DirectMapGenerationPanel(props: DirectMapGenerationPanelProps) {
  const busy = ['preparing', 'submitting', 'generating', 'validating'].includes(props.phase);
  return (
    <section className={styles.inspectorSection} aria-labelledby="direct-generation-heading">
      <div className={styles.sectionHeadingRow}>
        <div>
          <span className={styles.eyebrow}>PixelLab Pro</span>
          <h2 id="direct-generation-heading" className={styles.sectionTitleSmall}>Map image</h2>
        </div>
        <span className={styles.generationPhase} data-phase={props.phase}>{PHASE_LABELS[props.phase]}</span>
      </div>

      <div className={styles.singleAssetRow} data-status={props.asset?.status ?? 'idle'}>
        <span className={styles.assetStatusIcon} aria-hidden>
          {props.phase === 'ready' ? <CheckCircleOutlined /> : <ThunderboltOutlined />}
        </span>
        <span>
          <strong>Complete map PNG</strong>
          <small>{props.asset?.width && props.asset.height ? `${props.asset.width} × ${props.asset.height}` : 'Opaque full-map output'}</small>
        </span>
      </div>

      {props.error ? <p className={styles.inlineError} role="alert">{props.error}</p> : null}
      {props.asset?.lastErrorCode ? <code className={styles.errorCode}>{props.asset.lastErrorCode}</code> : null}

      {props.phase === 'idle' || props.phase === 'failed' ? (
        <button type="button" className={styles.primaryButton} disabled={!props.canPrepare || busy} onClick={props.onPrepare}>
          Prepare map generation
        </button>
      ) : null}
      {props.phase === 'awaiting-confirmation' ? (
        <button type="button" className={styles.primaryButton} onClick={props.onConfirm}>
          Confirm and generate map
        </button>
      ) : null}
      {(props.phase === 'failed' || props.phase === 'blocked') && props.canRetry ? (
        <button type="button" className={styles.secondaryButtonFull} onClick={props.onRetry}>
          <ReloadOutlined /> Retry generation
        </button>
      ) : null}
      {props.phase === 'ready' ? (
        <button type="button" className={styles.secondaryButtonFull} disabled={!props.canPrepare} onClick={props.onRegenerate}>
          <ReloadOutlined /> Regenerate map
        </button>
      ) : null}
      {busy ? <div className={styles.generationProgress} aria-label={PHASE_LABELS[props.phase]}><span /></div> : null}
    </section>
  );
}
