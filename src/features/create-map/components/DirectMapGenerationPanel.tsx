import { CheckCircleOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type {
  DirectMapGenerationAsset,
  DirectMapGenerationPhase,
} from '../hooks/useDirectMapGeneration';
import {
  shouldShowDirectMapPaidNotice,
  suppressDirectMapPaidNoticeForToday,
} from '../paidGenerationNotice';
import styles from '../CreateMapWorkbench.module.css';

type DirectMapGenerationPanelProps = {
  readOnly?: boolean;
  phase: DirectMapGenerationPhase;
  asset: DirectMapGenerationAsset | null;
  error: string | null;
  canGenerate: boolean;
  canRetry: boolean;
  canResolveUnknown: boolean;
  onGenerate: () => void;
  onRetry: () => void;
  onResolveUnknown: (acknowledgeDuplicateBilling: boolean) => void;
};

const PHASE_LABELS: Record<DirectMapGenerationPhase, string> = {
  idle: 'Not started',
  preparing: 'Preparing revision',
  'awaiting-confirmation': 'Ready to generate',
  submitting: 'Submitting request',
  generating: 'Generating map',
  validating: 'Validating image',
  ready: 'Map ready',
  failed: 'Generation failed',
  blocked: 'Generation blocked',
};

export function DirectMapGenerationPanel(props: DirectMapGenerationPanelProps) {
  const [paidPromptOpen, setPaidPromptOpen] = useState(false);
  const [skipPaidPromptToday, setSkipPaidPromptToday] = useState(false);
  const readOnly = props.readOnly ?? false;
  const busy = ['preparing', 'submitting', 'generating', 'validating'].includes(props.phase);
  const showGenerate = ['idle', 'awaiting-confirmation', 'failed', 'ready'].includes(props.phase);
  const unknownSubmission = props.asset?.status === 'queued'
    || (props.asset?.status === 'blocked' && props.asset.lastErrorCode === 'pixellab_submit_outcome_unknown');
  return (
    <section className={styles.inspectorSection} aria-labelledby="direct-generation-heading">
      <div className={styles.sectionHeadingRow}>
        <div>
          <span className={styles.eyebrow}>3 Generate</span>
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

      {paidPromptOpen ? (
        <div className={styles.generationConfirmation} role="group" aria-label="Generation cost confirmation">
          <strong>Paid PixelLab request</strong>
          <p>Generating the complete map PNG may incur provider charges.</p>
          <label className={styles.generationNoticeOption}>
            <input
              type="checkbox"
              checked={skipPaidPromptToday}
              onChange={(event) => setSkipPaidPromptToday(event.target.checked)}
            />
            <span>Do not show this again today</span>
          </label>
          <div className={styles.generationNoticeActions}>
            <button
              type="button"
              className={styles.secondaryButtonFull}
              onClick={() => setPaidPromptOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                if (skipPaidPromptToday) suppressDirectMapPaidNoticeForToday();
                setPaidPromptOpen(false);
                props.onGenerate();
              }}
            >
              Continue to generate
            </button>
          </div>
        </div>
      ) : null}

      {unknownSubmission ? (
        <form className={styles.unknownSubmissionResolution} onSubmit={(event) => event.preventDefault()}>
          <p>The previous paid submission has no confirmed provider job ID. It may still complete outside Keco.</p>
          <label>
            <input
              type="checkbox"
              name="acknowledgeDuplicateBilling"
              disabled={readOnly || !props.canResolveUnknown || busy}
              onChange={(event) => {
                const button = event.currentTarget.form?.elements.namedItem('restartUnknown');
                if (button instanceof HTMLButtonElement) button.disabled = !event.currentTarget.checked;
              }}
            />
            <span>I understand the previous request may still be billed.</span>
          </label>
          <button
            type="button"
            name="restartUnknown"
            className={styles.secondaryButtonFull}
            disabled
            onClick={() => { if (!readOnly) props.onResolveUnknown(true); }}
          >
            <ReloadOutlined /> Start a new paid attempt
          </button>
        </form>
      ) : null}

      {showGenerate && !paidPromptOpen ? (
        <button
          type="button"
          className={styles.primaryButton}
          disabled={readOnly || !props.canGenerate || busy}
          onClick={() => {
            if (shouldShowDirectMapPaidNotice()) {
              setSkipPaidPromptToday(false);
              setPaidPromptOpen(true);
              return;
            }
            props.onGenerate();
          }}
        >
          Generate map
        </button>
      ) : null}
      {(props.phase === 'failed' || props.phase === 'blocked') && props.canRetry ? (
        <button type="button" className={styles.secondaryButtonFull} disabled={readOnly} onClick={props.onRetry}>
          <ReloadOutlined /> Retry generation
        </button>
      ) : null}
      {busy ? <div className={styles.generationProgress} aria-label={PHASE_LABELS[props.phase]}><span /></div> : null}
    </section>
  );
}
