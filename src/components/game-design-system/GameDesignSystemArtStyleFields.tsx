'use client';

import { useEffect } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { GameArtStyleInput, GameArtStyleSnapshot } from '@/lib/game-art-style/schema';
import styles from './GameDesignSystemsPage.module.css';

type ArtStyleReadError = { code: 'UNSUPPORTED_SNAPSHOT' } | null;

type Props = {
  originalSnapshot: GameArtStyleSnapshot | null;
  artStyleReadError: ArtStyleReadError;
  value: GameArtStyleInput | null;
  changed: boolean;
  onChange: (value: GameArtStyleInput | null) => void;
  focusPath?: Array<string | number> | null;
};

function inputFromSnapshot(snapshot: GameArtStyleSnapshot | null): GameArtStyleInput {
  return {
    presetId: 'pixel-art',
    presetVersion: 1,
    customization: snapshot?.customization ?? { direction: '', referenceGames: [], avoid: '' },
  };
}

export function GameDesignSystemArtStyleFields({
  originalSnapshot,
  artStyleReadError,
  value,
  changed,
  onChange,
  focusPath,
}: Props) {
  useEffect(() => {
    if (!focusPath) return;
    let id = 'gds-version-art-heading';
    if (focusPath[1] === 'direction') id = 'gds-version-art-direction';
    if (focusPath[1] === 'avoid') id = 'gds-version-art-avoid';
    if (focusPath[1] === 'referenceGames' && typeof focusPath[2] === 'number') {
      id = `gds-version-art-reference-${focusPath[2]}-${String(focusPath[3] ?? 'name')}`;
    }
    window.setTimeout(() => globalThis.document.getElementById(id)?.focus(), 0);
  }, [focusPath]);

  if (artStyleReadError && value === null) {
    return (
      <section className={styles.artStyleEditor} aria-labelledby="gds-version-art-heading">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Version draft</span><h2 id="gds-version-art-heading" tabIndex={-1}>Art Style</h2></div>
        </div>
        <div className={styles.notice} role="status">This version contains an unsupported Art Style snapshot. It will be inherited exactly unless you explicitly replace it.</div>
        <button className={styles.secondaryButton} type="button" onClick={() => onChange(inputFromSnapshot(null))}>Replace with Pixel Art</button>
      </section>
    );
  }

  if (!originalSnapshot && value === null) {
    return (
      <section className={styles.artStyleEditor} aria-labelledby="gds-version-art-heading">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Version draft</span><h2 id="gds-version-art-heading" tabIndex={-1}>Art Style</h2></div>
        </div>
        <div className={styles.inlineEmpty}>No Art Style is specified in this version.</div>
        <button className={styles.secondaryButton} type="button" onClick={() => onChange(inputFromSnapshot(null))}>Add Pixel Art</button>
      </section>
    );
  }

  const draft = value ?? inputFromSnapshot(originalSnapshot);
  const updateCustomization = (next: Partial<GameArtStyleInput['customization']>) => onChange({
    ...draft,
    customization: { ...draft.customization, ...next },
  });

  return (
    <section className={styles.artStyleEditor} aria-labelledby="gds-version-art-heading">
      <div className={styles.sectionHeading}>
        <div><span className={styles.eyebrow}>Version draft</span><h2 id="gds-version-art-heading" tabIndex={-1}>Art Style</h2><p>Pixel Art / Revision 1{changed ? ' / Modified' : ' / Inherited'}</p></div>
        {changed ? <button className={styles.secondaryButton} type="button" aria-label="Undo Art Style changes" onClick={() => onChange(null)}>Undo changes</button> : null}
      </div>
      <div className={styles.artStyleFieldsStandalone}>
        <div className={styles.field}>
          <label htmlFor="gds-version-art-direction">Custom art direction</label>
          <textarea id="gds-version-art-direction" className={styles.textarea} maxLength={2000} value={draft.customization.direction ?? ''} onChange={(event) => updateCustomization({ direction: event.target.value })} />
        </div>
        <div className={styles.field}>
          <label>Visual reference games</label>
          <div className={styles.visualReferenceList}>
            {draft.customization.referenceGames.map((reference, index) => (
              <div className={styles.visualReferenceRow} key={index}>
                <input id={`gds-version-art-reference-${index}-name`} className={styles.input} maxLength={120} aria-label={`Visual reference game ${index + 1}`} value={reference.name} onChange={(event) => updateCustomization({ referenceGames: draft.customization.referenceGames.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
                <input id={`gds-version-art-reference-${index}-borrow`} className={styles.input} maxLength={500} aria-label={`What to borrow ${index + 1}`} value={reference.borrow} onChange={(event) => updateCustomization({ referenceGames: draft.customization.referenceGames.map((item, itemIndex) => itemIndex === index ? { ...item, borrow: event.target.value } : item) })} />
                <button className={styles.iconButtonDanger} type="button" aria-label={`Remove visual reference ${index + 1}`} title="Remove visual reference" onClick={() => updateCustomization({ referenceGames: draft.customization.referenceGames.filter((_, itemIndex) => itemIndex !== index) })}><DeleteOutlined /></button>
              </div>
            ))}
          </div>
          <button className={styles.secondaryButton} type="button" aria-label="Add visual reference" disabled={draft.customization.referenceGames.length >= 8} onClick={() => updateCustomization({ referenceGames: [...draft.customization.referenceGames, { name: '', borrow: '' }] })}><PlusOutlined /> Add visual reference</button>
        </div>
        <div className={styles.field}>
          <label htmlFor="gds-version-art-avoid">Visual avoid guidance</label>
          <textarea id="gds-version-art-avoid" className={styles.textarea} maxLength={1000} value={draft.customization.avoid ?? ''} onChange={(event) => updateCustomization({ avoid: event.target.value })} />
        </div>
      </div>
    </section>
  );
}
