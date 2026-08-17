'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { diffRuleSets } from '@/lib/game-design-system/ruleDiff';
import {
  parseRuleSet,
  type GameDesignRule,
  type GameDesignRuleSet,
  type TableGuidance,
} from '@/lib/game-design-system/ruleSchema';
import styles from './GameDesignSystemsPage.module.css';

const kindLabels: Record<GameDesignRule['kind'], string> = {
  principle: 'Principles',
  constraint: 'Constraints',
  pattern: 'Patterns',
  anti_pattern: 'Anti-patterns',
  check: 'Checks',
};

type Props = {
  base: GameDesignRuleSet;
  pending: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onCreate: (rules: GameDesignRuleSet) => void;
};

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function emptyRule(existing: GameDesignRule[]): GameDesignRule {
  let index = existing.length + 1;
  let id = 'new-rule-' + index;
  const ids = new Set(existing.map((rule) => rule.id));
  while (ids.has(id)) {
    index += 1;
    id = 'new-rule-' + index;
  }
  return {
    id,
    kind: 'principle',
    title: 'New rule',
    statement: 'Describe the design requirement.',
    appliesWhen: 'Describe when this rule applies.',
    severity: 'recommended',
  };
}

export function GameDesignSystemRuleEditor({ base, pending, onDirtyChange, onCancel, onCreate }: Props) {
  const [draft, setDraft] = useState<GameDesignRuleSet>(() => JSON.parse(JSON.stringify(base)) as GameDesignRuleSet);
  const [selectedRuleId, setSelectedRuleId] = useState(base.rules[0]?.id ?? '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedIndex = draft.rules.findIndex((rule) => rule.id === selectedRuleId);
  const selectedRule = selectedIndex >= 0 ? draft.rules[selectedIndex] : null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const diff = useMemo(() => diffRuleSets(base, draft), [base, draft]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  function updateRule<K extends keyof GameDesignRule>(field: K, value: GameDesignRule[K]) {
    if (selectedIndex < 0) return;
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule, index) => index === selectedIndex ? { ...rule, [field]: value } : rule),
    }));
  }

  function addRule() {
    const rule = emptyRule(draft.rules);
    setDraft((current) => ({ ...current, rules: [...current.rules, rule] }));
    setSelectedRuleId(rule.id);
    setSettingsOpen(false);
  }

  function deleteRule() {
    if (!selectedRule || draft.rules.length === 1) return;
    const next = draft.rules.filter((rule) => rule.id !== selectedRule.id);
    setDraft((current) => ({ ...current, rules: next }));
    setSelectedRuleId(next[Math.max(0, selectedIndex - 1)].id);
  }

  function moveRule(offset: -1 | 1) {
    const target = selectedIndex + offset;
    if (selectedIndex < 0 || target < 0 || target >= draft.rules.length) return;
    setDraft((current) => {
      const rules = [...current.rules];
      const item = rules[selectedIndex];
      rules[selectedIndex] = rules[target];
      rules[target] = item;
      return { ...current, rules };
    });
  }

  function updateGuidance(index: number, field: keyof TableGuidance, value: string | string[]) {
    setDraft((current) => ({
      ...current,
      tableGuidance: current.tableGuidance.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }));
  }

  function review() {
    setError(null);
    try {
      setDraft(parseRuleSet(draft));
      setReviewing(true);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'The rule set is invalid.');
    }
  }

  function cancel() {
    if (!dirty || window.confirm('Discard this rule-set draft?')) onCancel();
  }

  if (reviewing) {
    return (
      <section className={styles.reviewPanel} aria-label="Review rule changes">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Review</span><h3>Confirm immutable version</h3></div>
          <button className={styles.secondaryButton} type="button" onClick={() => setReviewing(false)}>Back to editor</button>
        </div>
        <div className={styles.diffMetrics}>
          <div><strong>{diff.added.length}</strong><span>Added</span></div>
          <div><strong>{diff.changed.length}</strong><span>Changed</span></div>
          <div><strong>{diff.removed.length}</strong><span>Removed</span></div>
          <div className={diff.conflicts.length ? styles.metricDanger : ''}><strong>{diff.conflicts.length}</strong><span>Conflicts</span></div>
        </div>
        <div className={styles.reviewList}>
          {diff.added.map((id) => <div key={'add-' + id}><span className={styles.changeAdded}>Added</span><code>{id}</code></div>)}
          {diff.changed.map((id) => <div key={'change-' + id}><span className={styles.changeChanged}>Changed</span><code>{id}</code></div>)}
          {diff.removed.map((id) => <div key={'remove-' + id}><span className={styles.changeRemoved}>Removed</span><code>{id}</code></div>)}
          {diff.added.length + diff.changed.length + diff.removed.length === 0 ? <p>No rule-level changes. System settings may still have changed.</p> : null}
          {diff.conflicts.map((conflict) => <div className={styles.conflictText} key={conflict.ruleId + conflict.reason}>{conflict.ruleId}: {conflict.reason}</div>)}
        </div>
        <div className={styles.formActions}>
          <span>Creation appends a new immutable version. Existing versions remain unchanged.</span>
          <button className={styles.primaryButton} type="button" aria-label="Create version" disabled={pending || !dirty} onClick={() => onCreate(draft)}><SaveOutlined /> Create version</button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.ruleEditorWorkbench}>
      <aside className={styles.ruleOutline} aria-label="Rule outline">
        <div className={styles.outlineActions}>
          <button className={styles.secondaryButton} type="button" onClick={addRule}><PlusOutlined /> Add rule</button>
          <button className={settingsOpen ? styles.outlineButtonActive : styles.outlineButton} type="button" onClick={() => setSettingsOpen(true)}><SettingOutlined /> System settings</button>
        </div>
        {Object.entries(kindLabels).map(([kind, label]) => {
          const rules = draft.rules.filter((rule) => rule.kind === kind);
          if (rules.length === 0) return null;
          return (
            <div className={styles.outlineGroup} key={kind}>
              <span>{label} <b>{rules.length}</b></span>
              {rules.map((rule) => <button className={!settingsOpen && selectedRuleId === rule.id ? styles.outlineButtonActive : styles.outlineButton} type="button" key={rule.id} onClick={() => { setSelectedRuleId(rule.id); setSettingsOpen(false); }}>{rule.title}</button>)}
            </div>
          );
        })}
      </aside>

      <div className={styles.ruleForm}>
        {settingsOpen ? (
          <>
            <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Rule set</span><h3>System settings</h3></div></div>
            <div className={styles.formGrid}>
              <div className={styles.field}><label htmlFor="rule-genres">Genres</label><input id="rule-genres" className={styles.input} value={draft.genres.join(', ')} onChange={(event) => setDraft((current) => ({ ...current, genres: splitList(event.target.value) }))} /></div>
              <div className={styles.field}><label htmlFor="rule-philosophies">Philosophies</label><input id="rule-philosophies" className={styles.input} value={draft.philosophies.join(', ')} onChange={(event) => setDraft((current) => ({ ...current, philosophies: splitList(event.target.value) }))} /></div>
              <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="rule-suitable">Suitable for</label><textarea id="rule-suitable" className={styles.textarea} value={draft.suitableFor} onChange={(event) => setDraft((current) => ({ ...current, suitableFor: event.target.value }))} /></div>
            </div>
            <div className={styles.sectionHeading}>
              <div><h3>Table guidance</h3><p>Canonical Keco table recommendations in this version.</p></div>
              <button className={styles.secondaryButton} type="button" onClick={() => setDraft((current) => ({ ...current, tableGuidance: [...current.tableGuidance, { table: 'New table', purpose: 'Describe its purpose.', fields: [] }] }))}><PlusOutlined /> Add table</button>
            </div>
            {draft.tableGuidance.length === 0 ? <div className={styles.inlineEmpty}>No table guidance.</div> : draft.tableGuidance.map((item, index) => (
              <div className={styles.guidanceRow} key={index}>
                <input className={styles.input} aria-label={'Table ' + (index + 1) + ' name'} value={item.table} onChange={(event) => updateGuidance(index, 'table', event.target.value)} />
                <input className={styles.input} aria-label={'Table ' + (index + 1) + ' purpose'} value={item.purpose} onChange={(event) => updateGuidance(index, 'purpose', event.target.value)} />
                <input className={styles.input} aria-label={'Table ' + (index + 1) + ' fields'} value={item.fields.join(', ')} onChange={(event) => updateGuidance(index, 'fields', splitList(event.target.value))} />
                <button className={styles.iconButton} type="button" aria-label={'Delete table ' + (index + 1)} title="Delete table guidance" onClick={() => setDraft((current) => ({ ...current, tableGuidance: current.tableGuidance.filter((_, itemIndex) => itemIndex !== index) }))}><DeleteOutlined /></button>
              </div>
            ))}
          </>
        ) : selectedRule ? (
          <>
            <div className={styles.sectionHeading}>
              <div><span className={styles.eyebrow}>{kindLabels[selectedRule.kind]}</span><h3>{selectedRule.title}</h3></div>
              <div className={styles.compactActions}>
                <button className={styles.iconButton} type="button" aria-label="Move rule up" title="Move rule up" disabled={selectedIndex === 0} onClick={() => moveRule(-1)}><ArrowUpOutlined /></button>
                <button className={styles.iconButton} type="button" aria-label="Move rule down" title="Move rule down" disabled={selectedIndex === draft.rules.length - 1} onClick={() => moveRule(1)}><ArrowDownOutlined /></button>
                <button className={styles.iconButtonDanger} type="button" aria-label="Delete rule" title="Delete rule" disabled={draft.rules.length === 1} onClick={deleteRule}><DeleteOutlined /></button>
              </div>
            </div>
            <div className={styles.formGrid}>
              <div className={styles.field}><label htmlFor="rule-id">Rule ID</label><input id="rule-id" className={styles.input} value={selectedRule.id} onChange={(event) => { updateRule('id', event.target.value); setSelectedRuleId(event.target.value); }} /></div>
              <div className={styles.field}><label htmlFor="rule-kind">Kind</label><select id="rule-kind" className={styles.select} value={selectedRule.kind} onChange={(event) => updateRule('kind', event.target.value as GameDesignRule['kind'])}>{Object.entries(kindLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
              <div className={styles.field}><label htmlFor="rule-title">Rule title</label><input id="rule-title" className={styles.input} value={selectedRule.title} onChange={(event) => updateRule('title', event.target.value)} /></div>
              <div className={styles.field}><label htmlFor="rule-severity">Severity</label><select id="rule-severity" className={styles.select} value={selectedRule.severity} onChange={(event) => updateRule('severity', event.target.value as GameDesignRule['severity'])}><option value="required">Required</option><option value="recommended">Recommended</option><option value="warning">Warning</option></select></div>
              <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="rule-statement">Rule statement</label><textarea id="rule-statement" className={styles.textarea} value={selectedRule.statement} onChange={(event) => updateRule('statement', event.target.value)} /></div>
              <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="rule-applies">Applies when</label><textarea id="rule-applies" className={styles.textarea} value={selectedRule.appliesWhen} onChange={(event) => updateRule('appliesWhen', event.target.value)} /></div>
              <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="rule-rationale">Rationale</label><textarea id="rule-rationale" className={styles.textarea} value={selectedRule.rationale ?? ''} onChange={(event) => updateRule('rationale', event.target.value || undefined)} /></div>
              <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="rule-evidence">Evidence</label><textarea id="rule-evidence" className={styles.textarea} value={selectedRule.evidence ?? ''} onChange={(event) => updateRule('evidence', event.target.value || undefined)} /></div>
            </div>
          </>
        ) : null}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <div className={styles.formActions}>
          <button className={styles.secondaryButton} type="button" onClick={cancel}>Cancel</button>
          <button className={styles.primaryButton} type="button" disabled={!dirty} onClick={review}>Review changes</button>
        </div>
      </div>

      <aside className={styles.ruleContext}>
        <span className={styles.eyebrow}>Draft context</span>
        <h3>New immutable version</h3>
        <dl>
          <div><dt>Rules</dt><dd>{draft.rules.length}</dd></div>
          <div><dt>Added</dt><dd>{diff.added.length}</dd></div>
          <div><dt>Changed</dt><dd>{diff.changed.length}</dd></div>
          <div><dt>Removed</dt><dd>{diff.removed.length}</dd></div>
        </dl>
        <p>Changes stay local until review and explicit version creation.</p>
      </aside>
    </section>
  );
}
