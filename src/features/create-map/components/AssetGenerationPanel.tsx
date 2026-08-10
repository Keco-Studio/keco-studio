import { CheckCircleOutlined, CloudUploadOutlined, LoadingOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import type { MapGenerationAsset, MapGenerationPhase } from '../hooks/useMapGeneration';
import styles from '../CreateMapWorkbench.module.css';

type AssetGenerationPanelProps = {
  assets: MapGenerationAsset[];
  phase: MapGenerationPhase;
  error: string | null;
  readyCount: number;
  failedCount: number;
  canPrepare: boolean;
  onPrepare: () => void;
  onConfirm: () => void;
  onRetry: (assetId: string) => void;
};

const phaseLabel: Record<MapGenerationPhase, string> = {
  idle: 'Ready to prepare',
  preparing: 'Preparing asset rows',
  'awaiting-confirmation': 'Review before generation',
  'generating-resources': 'Generating resources',
  'composing-background': 'Composing background',
  partial: 'Some resources need attention',
  ready: 'All resources ready',
  failed: 'Generation failed',
};

function StatusIcon({ status }: { status: MapGenerationAsset['status'] }) {
  if (status === 'ready') return <CheckCircleOutlined aria-hidden />;
  if (status === 'failed' || status === 'blocked') return <WarningOutlined aria-hidden />;
  if (status === 'generating' || status === 'queued') return <LoadingOutlined aria-hidden />;
  return <CloudUploadOutlined aria-hidden />;
}

export function AssetGenerationPanel({
  assets, phase, error, readyCount, failedCount, canPrepare, onPrepare, onConfirm, onRetry,
}: AssetGenerationPanelProps) {
  const preparing = phase === 'preparing';
  return (
    <section className={styles.inspectorSection} aria-labelledby="asset-generation-heading">
      <div className={styles.sectionHeadingRow}>
        <h2 id="asset-generation-heading" className={styles.sectionTitleSmall}>PixelLab resources</h2>
        <span className={failedCount ? styles.issueCount : styles.validCount}>{readyCount}/{assets.length || 0}</span>
      </div>
      <p className={styles.generationStatus}>{phaseLabel[phase]}</p>
      <ul className={styles.generationList} aria-label="PixelLab asset generation status">
        {assets.map((asset) => (
          <li key={asset.assetKey} className={styles.generationItem} data-status={asset.status}>
            <span className={styles.generationIcon}><StatusIcon status={asset.status} /></span>
            <span className={styles.generationCopy}><strong>{asset.assetKey}</strong><small>{asset.kind} · {asset.status}</small></span>
            {(asset.status === 'failed' || asset.status === 'blocked') && asset.id ? (
              <button type="button" className={styles.miniIconButton} aria-label={`Retry ${asset.assetKey}`} title="Retry" onClick={() => onRetry(asset.id as string)}><ReloadOutlined /></button>
            ) : null}
          </li>
        ))}
      </ul>
      {phase === 'idle' || phase === 'failed' ? (
        <button type="button" className={styles.secondaryButton} disabled={!canPrepare || preparing} onClick={onPrepare}>
          {phase === 'failed' ? 'Prepare again' : 'Prepare resources'}
        </button>
      ) : null}
      {phase === 'awaiting-confirmation' ? (
        <button type="button" className={styles.primaryButton} onClick={onConfirm}>Confirm and generate</button>
      ) : null}
      {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
    </section>
  );
}
