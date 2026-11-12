'use client';

import { useId } from 'react';
import styles from './ProjectIdentityFields.module.css';

export type ProjectIdentityDraft = {
  name: string;
  description: string;
};

export type ProjectIdentityFieldsProps = {
  value: ProjectIdentityDraft;
  onChange: (value: ProjectIdentityDraft) => void;
  disabled?: boolean;
  readOnly?: boolean;
  showName?: boolean;
};

export function ProjectIdentityFields({
  value,
  onChange,
  disabled = false,
  readOnly = false,
  showName = true,
}: ProjectIdentityFieldsProps) {
  const controlsDisabled = disabled || readOnly;
  const id = useId();
  const nameId = `${id}-name`;
  const descriptionId = `${id}-description`;

  return (
    <div className={styles.fields}>
      {showName ? (
        <div className={styles.field}>
          <label htmlFor={nameId}>Project name</label>
          <input
            id={nameId}
            className={styles.input}
            value={value.name}
            disabled={controlsDisabled}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            placeholder="Enter project name"
          />
        </div>
      ) : null}

      <div className={styles.field}>
        <label htmlFor={descriptionId}>Description</label>
        <textarea
          id={descriptionId}
          className={styles.textarea}
          value={value.description}
          disabled={controlsDisabled}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          placeholder="Give collaborators a short overview of this project."
        />
      </div>
    </div>
  );
}
