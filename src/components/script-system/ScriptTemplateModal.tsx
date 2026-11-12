'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from 'antd';
import type { ScriptStructureTemplate } from '@/lib/script-system/scriptStructureTemplates';
import styles from './ScriptTemplateModal.module.css';

export type ScriptTemplateModalProps = {
  open: boolean;
  mode: 'browse' | 'save';
  templates: readonly ScriptStructureTemplate[];
  activeReferenceId: string | null;
  onClose: () => void;
  onUseReference: (templateId: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onSaveTemplate: (name: string, description: string) => void | Promise<void>;
};

export function ScriptTemplateModal({
  open,
  mode,
  templates,
  activeReferenceId,
  onClose,
  onUseReference,
  onDeleteTemplate,
  onSaveTemplate,
}: ScriptTemplateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setError('');
    setSaving(false);
  }, [open, mode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim().slice(0, 80);
    if (!normalizedName) {
      setError('Please enter a template name');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSaveTemplate(normalizedName, description.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={mode === 'save' ? 'Save as Structure Template' : 'Structure Templates'}
      width={720}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
    >
      {mode === 'save' ? (
        <form className={styles.saveForm} onSubmit={submit}>
          <p className={styles.lead}>Save a snapshot of the current Script structure for future planning reference.</p>
          <label className={styles.field}>
            <span>Template name</span>
            <input
              aria-label="Template name"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Template description <em>Optional</em></span>
            <textarea
              aria-label="Template description"
              value={description}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className={styles.primaryButton}
              aria-label="Confirm save template"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <p className={styles.lead}>Selecting a template only previews its structure. It will not overwrite or change the current Script.</p>
          {templates.length > 0 ? (
            <div className={styles.templateGrid}>
              {templates.map((template) => {
                const active = template.id === activeReferenceId;
                return (
                  <article
                    key={template.id}
                    className={`${styles.templateCard} ${active ? styles.templateCardActive : ''}`}
                  >
                    <div className={styles.cardHeader}>
                      <div>
                        <span className={styles.sourceLabel}>
                          {template.isBuiltIn ? 'Built-in' : 'Personal'}
                        </span>
                        <h3>{template.name}</h3>
                      </div>
                      {!template.isBuiltIn ? (
                        <button
                          type="button"
                          className={styles.deleteButton}
                          aria-label={`Delete ${template.name}`}
                          onClick={() => onDeleteTemplate(template.id)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                    {template.description ? <p>{template.description}</p> : null}
                    <div className={styles.cardStats}>
                      <span>{template.counts.nodes} nodes</span>
                      <span>{template.counts.choices} choices</span>
                      <span>{template.counts.merges} merges</span>
                      <span>{template.counts.endings} endings</span>
                    </div>
                    <button
                      type="button"
                      className={active ? styles.activeButton : styles.referenceButton}
                      aria-label={`Use ${template.name} as reference`}
                      onClick={() => onUseReference(template.id)}
                    >
                      {active ? 'Using as Reference' : 'View Structure Reference'}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.healthyState}>No personal templates yet.</div>
          )}
        </div>
      )}
    </Modal>
  );
}
