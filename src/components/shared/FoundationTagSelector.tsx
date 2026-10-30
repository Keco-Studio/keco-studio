'use client';

import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { PROJECT_FOUNDATION_TAG_LIMIT, normalizeFoundationTag, normalizeFoundationTags } from '@/lib/projectFoundation';
import styles from './FoundationTagSelector.module.css';

type FoundationTagSelectorProps = {
  id: string;
  label: string;
  singularLabel: string;
  placeholder: string;
  presets: readonly string[];
  values: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  maxLength?: number;
};

function tagsMatch(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function FoundationTagSelector({
  id,
  label,
  singularLabel,
  placeholder,
  presets,
  values,
  onChange,
  maxLength,
}: FoundationTagSelectorProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const atLimit = values.length >= PROJECT_FOUNDATION_TAG_LIMIT;

  function addDraft(restoreFocus = true) {
    const normalized = normalizeFoundationTag(draft, presets);
    if (!normalized || atLimit) return;
    onChange((current) => normalizeFoundationTags([...current, normalized], presets));
    setDraft('');
    if (restoreFocus) inputRef.current?.focus();
  }

  function remove(value: string) {
    onChange((current) => current.filter((item) => !tagsMatch(item, value)));
  }

  function togglePreset(preset: string) {
    onChange((current) => {
      const selected = current.some((value) => tagsMatch(value, preset));
      if (selected) return current.filter((value) => !tagsMatch(value, preset));
      return normalizeFoundationTags([...current, preset], presets);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    addDraft();
  }

  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.tagInput}>
        {values.map((value) => (
          <span className={styles.selectedTag} key={value.toLowerCase()}>
            <span>{value}</span>
            <button
              className={styles.tagRemoveButton}
              type="button"
              aria-label={`Remove ${singularLabel} ${value}`}
              title={`Remove ${value}`}
              onClick={() => remove(value)}
            >
              <CloseOutlined />
            </button>
          </span>
        ))}
        <input
          id={id}
          ref={inputRef}
          className={styles.tagTextInput}
          value={draft}
          maxLength={maxLength}
          readOnly={atLimit}
          aria-disabled={atLimit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addDraft(false)}
          placeholder={atLimit ? '' : placeholder}
        />
        <button
          className={styles.tagAddButton}
          type="button"
          aria-label={`Add ${singularLabel}`}
          title={`Add ${singularLabel}`}
          disabled={atLimit || !draft.trim()}
          onClick={() => addDraft()}
        >
          <PlusOutlined />
        </button>
      </div>
      <div className={styles.tagMeta}><span>{values.length} / {PROJECT_FOUNDATION_TAG_LIMIT}</span></div>
      <div className={styles.checks} aria-label={`${label} suggestions`}>
        {presets.map((preset) => {
          const selected = values.some((value) => tagsMatch(value, preset));
          return (
            <button
              type="button"
              key={preset}
              className={selected ? styles.checkActive : styles.check}
              aria-pressed={selected}
              disabled={!selected && atLimit}
              onClick={() => togglePreset(preset)}
            >
              {preset}
            </button>
          );
        })}
      </div>
    </div>
  );
}
