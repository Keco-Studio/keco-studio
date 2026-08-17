'use client';

import { useEffect, useMemo, useState } from 'react';
import { SaveOutlined } from '@ant-design/icons';
import {
  parseGameDesignDocument,
  type GameDesignDocument,
} from '@/lib/game-design-system/ruleSchema';
import styles from './GameDesignSystemsPage.module.css';

const sections: Array<{ key: keyof GameDesignDocument; label: string }> = [
  { key: 'designIntent', label: 'Design intent' },
  { key: 'playerFantasy', label: 'Player fantasy' },
  { key: 'coreLoop', label: 'Core loop' },
  { key: 'decisionStructure', label: 'Decision structure' },
  { key: 'systemBoundaries', label: 'Rules and system boundaries' },
  { key: 'progressionEconomy', label: 'Progression and economy' },
  { key: 'contentModel', label: 'Content model' },
  { key: 'difficultyBalance', label: 'Difficulty and balance' },
  { key: 'experiencePresentation', label: 'Experience and presentation' },
];

type Props = {
  base: GameDesignDocument;
  pending: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSave: (document: GameDesignDocument) => Promise<void>;
};

export function GameDesignSystemDocumentEditor({ base, pending, onDirtyChange, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState<GameDesignDocument>(() => ({ ...base }));
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(base), [base, draft]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const cancel = () => {
    if (!dirty || window.confirm('Discard this document draft?')) onCancel();
  };

  const review = () => {
    try {
      setDraft(parseGameDesignDocument(draft));
      setError('');
      setReviewing(true);
    } catch {
      setError('Complete every section before reviewing the document.');
    }
  };

  if (reviewing) {
    return (
      <section className={styles.documentEditor} role="tabpanel">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Review</span><h2>Document changes</h2></div>
        </div>
        <div className={styles.documentReview}>
          {sections.map((section) => (
            <section key={section.key}>
              <h3>{section.label}</h3>
              <p>{draft[section.key]}</p>
            </section>
          ))}
        </div>
        <div className={styles.formActions}>
          <span>Creating a version preserves the current rules and appends this document revision.</span>
          <button className={styles.secondaryButton} type="button" disabled={pending} onClick={() => setReviewing(false)}>Back to edit</button>
          <button className={styles.primaryButton} type="button" aria-label="Create version" disabled={pending || !dirty} onClick={() => void onSave(draft)}><SaveOutlined /> Create version</button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.documentEditor} role="tabpanel">
      <div className={styles.sectionHeading}>
        <div><span className={styles.eyebrow}>Local draft</span><h2>Edit design document</h2></div>
      </div>
      <div className={styles.documentEditorGrid}>
        {sections.map((section) => (
          <div className={styles.field} key={section.key}>
            <label htmlFor={'gds-document-' + section.key}>{section.label}</label>
            <textarea
              id={'gds-document-' + section.key}
              className={styles.documentTextarea}
              maxLength={4000}
              value={draft[section.key]}
              onChange={(event) => setDraft((current) => ({ ...current, [section.key]: event.target.value }))}
            />
          </div>
        ))}
      </div>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.formActions}>
        <button className={styles.secondaryButton} type="button" disabled={pending} onClick={cancel}>Cancel</button>
        <button className={styles.primaryButton} type="button" disabled={!dirty || pending} onClick={review}>Review document</button>
      </div>
    </section>
  );
}
