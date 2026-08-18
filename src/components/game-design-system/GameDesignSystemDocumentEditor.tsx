'use client';

import { useEffect, useState } from 'react';
import { SaveOutlined } from '@ant-design/icons';
import { parseGameDesignDocument } from '@/lib/game-design-system/ruleSchema';
import type { GameDesignDocument } from '@/lib/game-design-system/ruleSchema';
import styles from './GameDesignSystemsPage.module.css';

export const gameDesignDocumentSections: Array<{ key: keyof GameDesignDocument; label: string; required: boolean }> = [
  { key: 'gameBackground', label: 'Game background & setting', required: false },
  { key: 'designIntent', label: 'Design intent', required: true },
  { key: 'playerFantasy', label: 'Player fantasy', required: true },
  { key: 'coreLoop', label: 'Core loop', required: true },
  { key: 'decisionStructure', label: 'Decision structure', required: true },
  { key: 'systemBoundaries', label: 'Rules and system boundaries', required: true },
  { key: 'progressionEconomy', label: 'Progression and economy', required: true },
  { key: 'contentModel', label: 'Content model', required: true },
  { key: 'difficultyBalance', label: 'Difficulty and balance', required: true },
  { key: 'experiencePresentation', label: 'Experience and presentation', required: true },
];

type ControlledProps = {
  value: GameDesignDocument;
  onChange: (value: GameDesignDocument) => void;
};

type LegacyWorkspaceProps = {
  base: GameDesignDocument;
  pending: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSave: (document: GameDesignDocument) => Promise<void>;
};

type Props = ControlledProps | LegacyWorkspaceProps;

export function GameDesignSystemDocumentEditor(props: Props) {
  return 'value' in props
    ? <DocumentFields value={props.value} onChange={props.onChange} />
    : <LegacyDocumentEditor {...props} />;
}

function DocumentFields({ value, onChange }: ControlledProps) {
  function updateField(key: keyof GameDesignDocument, fieldValue: string) {
    const next = { ...value };
    if (key === 'gameBackground' && !fieldValue) delete next.gameBackground;
    else next[key] = fieldValue;
    onChange(next);
  }

  return (
    <section className={styles.documentEditor} aria-labelledby="gds-version-document-heading">
      <div className={styles.sectionHeading}>
        <div><span className={styles.eyebrow}>Version draft</span><h2 id="gds-version-document-heading" tabIndex={-1}>Document</h2></div>
      </div>
      <div className={styles.documentEditorGrid}>
        {gameDesignDocumentSections.map((section) => (
          <div className={styles.field} key={section.key}>
            <label htmlFor={'gds-document-' + section.key}>{section.label}</label>
            <textarea
              id={'gds-document-' + section.key}
              className={styles.documentTextarea}
              maxLength={4000}
              required={section.required}
              value={value[section.key] ?? ''}
              onChange={(event) => updateField(section.key, event.target.value)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function LegacyDocumentEditor({ base, pending, onDirtyChange, onCancel, onSave }: LegacyWorkspaceProps) {
  const [draft, setDraft] = useState(() => cloneDocument(base));
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  if (reviewing) {
    return (
      <section className={styles.documentEditor}>
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Review</span><h2>Document changes</h2></div></div>
        <div className={styles.documentReview}>{gameDesignDocumentSections.map((section) => <section key={section.key}><h3>{section.label}</h3><p>{draft[section.key] || 'Not specified'}</p></section>)}</div>
        <div className={styles.formActions}>
          <button className={styles.secondaryButton} type="button" disabled={pending} onClick={() => setReviewing(false)}>Back to edit</button>
          <button className={styles.primaryButton} type="button" aria-label="Create version" disabled={pending || !dirty} onClick={() => void onSave(draft)}><SaveOutlined /> Create version</button>
        </div>
      </section>
    );
  }

  return (
    <>
      <DocumentFields value={draft} onChange={setDraft} />
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.formActions}>
        <button className={styles.secondaryButton} type="button" disabled={pending} onClick={() => { if (!dirty || window.confirm('Discard this document draft?')) onCancel(); }}>Cancel</button>
        <button className={styles.primaryButton} type="button" disabled={!dirty || pending} onClick={() => { try { setDraft(parseGameDesignDocument(draft)); setError(''); setReviewing(true); } catch { setError('Complete every section before reviewing the document.'); } }}>Review document</button>
      </div>
    </>
  );
}

function cloneDocument(value: GameDesignDocument): GameDesignDocument {
  return JSON.parse(JSON.stringify(value)) as GameDesignDocument;
}
