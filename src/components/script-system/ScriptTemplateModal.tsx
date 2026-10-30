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
      setError('请输入模板名称');
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
      title={mode === 'save' ? '保存为结构模板' : '结构模板'}
      width={720}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
    >
      {mode === 'save' ? (
        <form className={styles.saveForm} onSubmit={submit}>
          <p className={styles.lead}>保存当前 Script 的结构快照，之后可作为编排参考。</p>
          <label className={styles.field}>
            <span>模板名称</span>
            <input
              aria-label="模板名称"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>模板说明 <em>选填</em></span>
            <textarea
              aria-label="模板说明"
              value={description}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>取消</button>
            <button
              type="submit"
              className={styles.primaryButton}
              aria-label="确认保存模板"
              disabled={saving}
            >
              {saving ? '保存中…' : '保存模板'}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <p className={styles.lead}>选择模板后只会预览结构，不会覆盖或改写当前 Script。</p>
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
                          {template.isBuiltIn ? '内置' : '个人'}
                        </span>
                        <h3>{template.name}</h3>
                      </div>
                      {!template.isBuiltIn ? (
                        <button
                          type="button"
                          className={styles.deleteButton}
                          aria-label={`删除 ${template.name}`}
                          onClick={() => onDeleteTemplate(template.id)}
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                    {template.description ? <p>{template.description}</p> : null}
                    <div className={styles.cardStats}>
                      <span>{template.counts.nodes} 节点</span>
                      <span>{template.counts.choices} 选择</span>
                      <span>{template.counts.merges} 汇合</span>
                      <span>{template.counts.endings} 结局</span>
                    </div>
                    <button
                      type="button"
                      className={active ? styles.activeButton : styles.referenceButton}
                      aria-label={`使用 ${template.name} 作为参考`}
                      onClick={() => onUseReference(template.id)}
                    >
                      {active ? '正在参考' : '查看结构参考'}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.healthyState}>还没有个人模板。</div>
          )}
        </div>
      )}
    </Modal>
  );
}
