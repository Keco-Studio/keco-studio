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
  onCancel: () => void;
  onSubmit: (options: GddGenerationOptions) => void;
};

export function GddGenerationDialog({ open, projectName, pending = false, onCancel, onSubmit }: Props) {
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
          <div><span className={styles.eyebrow}>GDD generation</span><h3 id="gdd-dialog-title">为 {projectName} 生成设计文档</h3></div>
          <button className={styles.iconButton} type="button" aria-label="关闭" onClick={onCancel}>×</button>
        </div>
        <fieldset className={styles.modeFieldset}>
          <legend>生成模式</legend>
          <label className={styles.modeOption}>
            <input type="radio" name="gdd-mode" value="professional" checked={mode === 'professional'} onChange={() => setMode('professional')} />
            <span><strong>专业完整</strong><small>结构化长文档，覆盖玩法、系统、内容与叙事。</small></span>
          </label>
          <label className={styles.modeOption}>
            <input type="radio" name="gdd-mode" value="quick" checked={mode === 'quick'} onChange={() => setMode('quick')} />
            <span><strong>快速草稿</strong><small>快速生成可继续编辑的核心设计骨架。</small></span>
          </label>
        </fieldset>
        <label className={styles.field} htmlFor="gdd-creative-brief"><span>项目创意说明 <small>可选</small></span><textarea id="gdd-creative-brief" className={styles.textarea} maxLength={4000} value={creativeBrief} onChange={(event) => setCreativeBrief(event.target.value)} placeholder="补充主题、受众、独特卖点或希望重点展开的内容" /></label>
        <div className={styles.dialogActions}>
          <button className={styles.secondaryButton} type="button" disabled={pending} onClick={onCancel}>取消</button>
          <button className={styles.primaryButton} type="button" disabled={pending} onClick={() => onSubmit({ mode, ...(creativeBrief.trim() ? { creativeBrief: creativeBrief.trim() } : {}) })}>{pending ? '正在生成...' : '开始生成'}</button>
        </div>
      </section>
    </div>
  );
}
