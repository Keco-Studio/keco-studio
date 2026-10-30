'use client';

import { useId, type SetStateAction } from 'react';
import {
  DESIGN_PHILOSOPHY_PRESETS,
  GAME_GENRE_PRESETS,
  type ProjectFoundationDraft,
} from '@/lib/projectFoundation';
import { FoundationTagSelector } from '@/components/shared/FoundationTagSelector';
import styles from './ProjectFoundationFields.module.css';

export type ProjectFoundationFieldsProps = {
  value: ProjectFoundationDraft;
  onChange: (value: ProjectFoundationDraft) => void;
  disabled?: boolean;
  readOnly?: boolean;
  showName?: boolean;
};

function resolveTags(update: SetStateAction<string[]>, current: string[]): string[] {
  return typeof update === 'function' ? update(current) : update;
}

export function ProjectFoundationFields({
  value,
  onChange,
  disabled = false,
  readOnly = false,
  showName = true,
}: ProjectFoundationFieldsProps) {
  const controlsDisabled = disabled || readOnly;
  const id = useId();
  const nameId = `${id}-name`;
  const genresId = `${id}-genres`;
  const philosophiesId = `${id}-philosophies`;
  const descriptionId = `${id}-description`;

  return (
    <div className={styles.fields}>
      {showName ? (
        <div className={`${styles.field} ${styles.nameField}`}>
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

      <fieldset className={styles.tagFields} disabled={controlsDisabled}>
        <FoundationTagSelector
          id={genresId}
          label="Game genres"
          singularLabel="game genre"
          placeholder="Custom genre"
          presets={GAME_GENRE_PRESETS}
          values={value.genres}
          onChange={(update) => onChange({
            ...value,
            genres: resolveTags(update, value.genres),
          })}
        />
        <FoundationTagSelector
          id={philosophiesId}
          label="Design philosophies"
          singularLabel="design philosophy"
          placeholder="Custom philosophy"
          presets={DESIGN_PHILOSOPHY_PRESETS}
          values={value.designPhilosophies}
          onChange={(update) => onChange({
            ...value,
            designPhilosophies: resolveTags(update, value.designPhilosophies),
          })}
        />
      </fieldset>

      <div className={`${styles.field} ${styles.descriptionField}`}>
        <label htmlFor={descriptionId}>Description</label>
        <textarea
          id={descriptionId}
          className={styles.textarea}
          value={value.description}
          disabled={controlsDisabled}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          placeholder="Describe the intended player experience."
        />
      </div>
    </div>
  );
}
