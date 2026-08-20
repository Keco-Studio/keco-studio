'use client';

import { useEffect, useState } from 'react';
import styles from './GameDesignSystemsPage.module.css';

export type GddGenerationOptions = {
  mode: 'quick' | 'professional';
  creativeBrief?: string;
};

type Props = {
  open: boolean;
  projectName: string;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (options: GddGenerationOptions) => void;
};

export function GddGenerationDialog({ open, projectName, pending = false, error = null, onCancel, onSubmit }: Props) {
  const [mode, setMode] = useState<GddGenerationOptions['mode']>('professional');
  const [creativeBrief, setCreativeBrief] = useState('');

  useEffect(() => {
    if (open) {
      setMode('professional');
      setCreativeBrief('');
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className={styles.gddDialog} role="dialog" aria-modal="true" aria-labelledby="gdd-dialog-title">
        <div className={styles.dialogHeader}>
          <div><span className={styles.eyebrow}>GDD generation</span><h3 id="gdd-dialog-title">Generate a design document for {projectName}</h3></div>
          <button className={styles.iconButton} type="button" aria-label="Close" onClick={onCancel}>×</button>
        </div>
        <fieldset className={styles.modeFieldset}>
          <legend>Generation mode</legend>
          <label className={styles.modeOption}>
            <input type="radio" name="gdd-mode" value="professional" checked={mode === 'professional'} onChange={() => setMode('professional')} />
            <span><strong>Professional</strong><small>A structured long document covering gameplay, systems, content, and narrative.</small></span>
          </label>
          <label className={styles.modeOption}>
            <input type="radio" name="gdd-mode" value="quick" checked={mode === 'quick'} onChange={() => setMode('quick')} />
            <span><strong>Quick draft</strong><small>Quickly generate an editable core design outline.</small></span>
          </label>
        </fieldset>
        <label className={styles.field} htmlFor="gdd-creative-brief"><span>Creative brief <small>optional</small></span><textarea id="gdd-creative-brief" className={styles.textarea} maxLength={4000} value={creativeBrief} onChange={(event) => setCreativeBrief(event.target.value)} placeholder="Add theme, audience, unique selling points, or areas you want expanded" /></label>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <div className={styles.dialogActions}>
          <button className={styles.secondaryButton} type="button" disabled={pending} onClick={onCancel}>Cancel</button>
          <button className={styles.primaryButton} type="button" disabled={pending} onClick={() => onSubmit({ mode, ...(creativeBrief.trim() ? { creativeBrief: creativeBrief.trim() } : {}) })}>{pending ? 'Generating...' : 'Start generation'}</button>
        </div>
      </section>
    </div>
  );
}
