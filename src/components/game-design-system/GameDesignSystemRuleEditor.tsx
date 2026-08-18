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
import { parseRuleSet } from '@/lib/game-design-system/ruleSchema';
import type { GameDesignRule, GameDesignRuleSet, TableGuidance } from '@/lib/game-design-system/ruleSchema';
import styles from './GameDesignSystemsPage.module.css';

const kindLabels: Record<GameDesignRule['kind'], string> = {
  principle: 'Principles',
  constraint: 'Constraints',
  pattern: 'Patterns',
  anti_pattern: 'Anti-patterns',
  check: 'Checks',
};

type ControlledProps = {
  value: GameDesignRuleSet;
  onChange: (value: GameDesignRuleSet) => void;
  focusPath?: Array<string | number> | null;
};

type LegacyWorkspaceProps = {
  base: GameDesignRuleSet;
  pending: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onCreate: (rules: GameDesignRuleSet) => void;
};

type Props = ControlledProps | LegacyWorkspaceProps;

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function emptyRule(existing: GameDesignRule[]): GameDesignRule {
  const ids = new Set(existing.map((rule) => rule.id));
  let index = existing.length + 1;
  while (ids.has(`new-rule-${index}`)) index += 1;
  return {
    id: `new-rule-${index}`,
    kind: 'principle',
    title: 'New rule',
    statement: 'Describe the design requirement.',
    appliesWhen: 'Describe when this rule applies.',
    severity: 'recommended',
  };
}

export function GameDesignSystemRuleEditor(props: Props) {
  return 'value' in props
    ? <RuleFields value={props.value} onChange={props.onChange} focusPath={props.focusPath} />
    : <LegacyRuleEditor {...props} />;
}

function RuleFields({ value, onChange, focusPath }: ControlledProps) {
  const [selectedRuleId, setSelectedRuleId] = useState(value.rules[0]?.id ?? '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<GameDesignRule['kind'] | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<GameDesignRule['severity'] | 'all'>('all');
  const [genresText, setGenresText] = useState(() => value.genres.join(', '));
  const [philosophiesText, setPhilosophiesText] = useState(() => value.philosophies.join(', '));
  const [guidanceFieldsText, setGuidanceFieldsText] = useState(() => value.tableGuidance.map((item) => item.fields.join(', ')));
  const visibleRules = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return value.rules.filter((rule) => (
      (kindFilter === 'all' || rule.kind === kindFilter)
      && (severityFilter === 'all' || rule.severity === severityFilter)
      && (!query || `${rule.id} ${rule.title} ${rule.statement}`.toLocaleLowerCase().includes(query))
    ));
  }, [kindFilter, search, severityFilter, value.rules]);
  const selectedRule = visibleRules.find((rule) => rule.id === selectedRuleId)
    ?? visibleRules[0]
    ?? null;
  const actualSelectedIndex = selectedRule ? value.rules.indexOf(selectedRule) : -1;

  useEffect(() => {
    if (!focusPath) return;
    const timer = window.setTimeout(() => {
      const [domain, indexOrField, ruleField] = focusPath;
      let id = 'gds-version-rules-heading';
      if (domain === 'rules' && typeof indexOrField === 'number') {
        const rule = value.rules[indexOrField];
        if (rule) setSelectedRuleId(rule.id);
        setSettingsOpen(false);
        setSearch('');
        setKindFilter('all');
        setSeverityFilter('all');
        const fieldIds: Partial<Record<keyof GameDesignRule, string>> = {
          id: 'rule-id', kind: 'rule-kind', title: 'rule-title', statement: 'rule-statement',
          appliesWhen: 'rule-applies', rationale: 'rule-rationale', severity: 'rule-severity', evidence: 'rule-evidence',
        };
        id = fieldIds[ruleField as keyof GameDesignRule] ?? id;
      } else {
        setSettingsOpen(true);
        if (domain === 'genres') id = 'rule-genres';
        if (domain === 'philosophies') id = 'rule-philosophies';
        if (domain === 'suitableFor') id = 'rule-suitable';
        if (domain === 'tableGuidance' && typeof indexOrField === 'number') id = `rule-guidance-${indexOrField}-${String(ruleField)}`;
      }
      window.setTimeout(() => globalThis.document.getElementById(id)?.focus(), 0);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusPath, value.rules]);

  function updateRule<K extends keyof GameDesignRule>(field: K, nextValue: GameDesignRule[K]) {
    if (actualSelectedIndex < 0) return;
    onChange({
      ...value,
      rules: value.rules.map((rule, index) => index === actualSelectedIndex ? { ...rule, [field]: nextValue } : rule),
    });
  }

  function addRule() {
    const rule = emptyRule(value.rules);
    onChange({ ...value, rules: [...value.rules, rule] });
    setSelectedRuleId(rule.id);
    setSettingsOpen(false);
  }

  function deleteRule() {
    if (!selectedRule || value.rules.length === 1) return;
    const next = value.rules.filter((_, index) => index !== actualSelectedIndex);
    onChange({ ...value, rules: next });
    setSelectedRuleId(next[Math.max(0, actualSelectedIndex - 1)].id);
  }

  function moveRule(offset: -1 | 1) {
    const target = actualSelectedIndex + offset;
    if (actualSelectedIndex < 0 || target < 0 || target >= value.rules.length) return;
    const next = [...value.rules];
    [next[actualSelectedIndex], next[target]] = [next[target], next[actualSelectedIndex]];
    onChange({ ...value, rules: next });
  }

  function updateGuidance(index: number, field: keyof TableGuidance, nextValue: string | string[]) {
    onChange({
      ...value,
      tableGuidance: value.tableGuidance.map((item, itemIndex) => itemIndex === index
        ? { ...item, [field]: nextValue }
        : item),
    });
  }

  return (
    <section className={styles.ruleEditorWorkbench} aria-labelledby="gds-version-rules-heading">
      <aside className={styles.ruleOutline} aria-label="Rule outline">
        <div className={styles.outlineActions}>
          <button className={styles.secondaryButton} type="button" onClick={addRule}><PlusOutlined /> Add rule</button>
          <button className={settingsOpen ? styles.outlineButtonActive : styles.outlineButton} type="button" aria-label="System settings" onClick={() => setSettingsOpen(true)}><SettingOutlined /> System settings</button>
        </div>
        <div className={styles.ruleFilters}>
          <label className={styles.field}>Search rules<input className={styles.input} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className={styles.field}>Filter by kind<select className={styles.select} value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}><option value="all">All kinds</option>{Object.entries(kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
          <label className={styles.field}>Filter by severity<select className={styles.select} value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as typeof severityFilter)}><option value="all">All severities</option><option value="required">Required</option><option value="recommended">Recommended</option><option value="warning">Warning</option></select></label>
          <label className={styles.compactRuleSelect}>Selected rule<select className={styles.select} value={settingsOpen ? '__settings__' : selectedRule?.id ?? ''} onChange={(event) => { if (event.target.value === '__settings__') setSettingsOpen(true); else { setSelectedRuleId(event.target.value); setSettingsOpen(false); } }}><option value="__settings__">System settings</option>{visibleRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.title}</option>)}</select></label>
        </div>
        {Object.entries(kindLabels).map(([kind, label]) => {
          const matching = visibleRules.filter((rule) => rule.kind === kind);
          if (!matching.length) return null;
          return (
            <div className={styles.outlineGroup} key={kind}>
              <span>{label} <b>{matching.length}</b></span>
              {matching.map((rule) => <button className={!settingsOpen && selectedRule?.id === rule.id ? styles.outlineButtonActive : styles.outlineButton} type="button" key={rule.id} onClick={() => { setSelectedRuleId(rule.id); setSettingsOpen(false); }}>{rule.title}</button>)}
            </div>
          );
        })}
      </aside>

      <div className={styles.ruleForm}>
        {settingsOpen ? (
          <>
            <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Rule set</span><h2 id="gds-version-rules-heading" tabIndex={-1}>System settings</h2></div></div>
            <div className={styles.formGrid}>
              <div className={styles.field}><label htmlFor="rule-genres">Genres</label><input id="rule-genres" className={styles.input} value={genresText} onChange={(event) => { setGenresText(event.target.value); onChange({ ...value, genres: splitList(event.target.value) }); }} /></div>
              <div className={styles.field}><label htmlFor="rule-philosophies">Philosophies</label><input id="rule-philosophies" className={styles.input} value={philosophiesText} onChange={(event) => { setPhilosophiesText(event.target.value); onChange({ ...value, philosophies: splitList(event.target.value) }); }} /></div>
              <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="rule-suitable">Suitable for</label><textarea id="rule-suitable" className={styles.textarea} value={value.suitableFor} onChange={(event) => onChange({ ...value, suitableFor: event.target.value })} /></div>
            </div>
            <div className={styles.sectionHeading}>
              <div><h3>Table guidance</h3><p>Canonical Keco table recommendations in this version.</p></div>
              <button className={styles.secondaryButton} type="button" onClick={() => { setGuidanceFieldsText((current) => [...current, '']); onChange({ ...value, tableGuidance: [...value.tableGuidance, { table: 'New table', purpose: 'Describe its purpose.', fields: [] }] }); }}><PlusOutlined /> Add table</button>
            </div>
            {value.tableGuidance.length === 0 ? <div className={styles.inlineEmpty}>No table guidance.</div> : value.tableGuidance.map((item, index) => (
              <div className={styles.guidanceRow} key={index}>
                <input id={`rule-guidance-${index}-table`} className={styles.input} aria-label={`Table ${index + 1} name`} value={item.table} onChange={(event) => updateGuidance(index, 'table', event.target.value)} />
                <input id={`rule-guidance-${index}-purpose`} className={styles.input} aria-label={`Table ${index + 1} purpose`} value={item.purpose} onChange={(event) => updateGuidance(index, 'purpose', event.target.value)} />
                <input id={`rule-guidance-${index}-fields`} className={styles.input} aria-label={`Table ${index + 1} fields`} value={guidanceFieldsText[index] ?? item.fields.join(', ')} onChange={(event) => { setGuidanceFieldsText((current) => current.map((text, itemIndex) => itemIndex === index ? event.target.value : text)); updateGuidance(index, 'fields', splitList(event.target.value)); }} />
                <button className={styles.iconButtonDanger} type="button" aria-label={`Delete table ${index + 1}`} title="Delete table guidance" onClick={() => { setGuidanceFieldsText((current) => current.filter((_, itemIndex) => itemIndex !== index)); onChange({ ...value, tableGuidance: value.tableGuidance.filter((_, itemIndex) => itemIndex !== index) }); }}><DeleteOutlined /></button>
              </div>
            ))}
          </>
        ) : selectedRule ? (
          <>
            <div className={styles.sectionHeading}>
              <div><span className={styles.eyebrow}>{kindLabels[selectedRule.kind]}</span><h2 id="gds-version-rules-heading" tabIndex={-1}>{selectedRule.title}</h2></div>
              <div className={styles.compactActions}>
                <button className={styles.iconButton} type="button" aria-label="Move rule up" title="Move rule up" disabled={actualSelectedIndex === 0} onClick={() => moveRule(-1)}><ArrowUpOutlined /></button>
                <button className={styles.iconButton} type="button" aria-label="Move rule down" title="Move rule down" disabled={actualSelectedIndex === value.rules.length - 1} onClick={() => moveRule(1)}><ArrowDownOutlined /></button>
                <button className={styles.iconButtonDanger} type="button" aria-label="Delete rule" title="Delete rule" disabled={value.rules.length === 1} onClick={deleteRule}><DeleteOutlined /></button>
              </div>
            </div>
            <div className={styles.formGrid}>
              <div className={styles.field}><label htmlFor="rule-id">Rule ID</label><input id="rule-id" className={styles.input} value={selectedRule.id} onChange={(event) => { updateRule('id', event.target.value); setSelectedRuleId(event.target.value); }} /></div>
              <div className={styles.field}><label htmlFor="rule-kind">Kind</label><select id="rule-kind" className={styles.select} value={selectedRule.kind} onChange={(event) => updateRule('kind', event.target.value as GameDesignRule['kind'])}>{Object.entries(kindLabels).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}</select></div>
              <div className={styles.field}><label htmlFor="rule-title">Rule title</label><input id="rule-title" className={styles.input} value={selectedRule.title} onChange={(event) => updateRule('title', event.target.value)} /></div>
              <div className={styles.field}><label htmlFor="rule-severity">Severity</label><select id="rule-severity" className={styles.select} value={selectedRule.severity} onChange={(event) => updateRule('severity', event.target.value as GameDesignRule['severity'])}><option value="required">Required</option><option value="recommended">Recommended</option><option value="warning">Warning</option></select></div>
              <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="rule-statement">Rule statement</label><textarea id="rule-statement" className={styles.textarea} value={selectedRule.statement} onChange={(event) => updateRule('statement', event.target.value)} /></div>
              <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="rule-applies">Applies when</label><textarea id="rule-applies" className={styles.textarea} value={selectedRule.appliesWhen} onChange={(event) => updateRule('appliesWhen', event.target.value)} /></div>
              <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="rule-rationale">Rationale</label><textarea id="rule-rationale" className={styles.textarea} value={selectedRule.rationale ?? ''} onChange={(event) => updateRule('rationale', event.target.value || undefined)} /></div>
              <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="rule-evidence">Evidence</label><textarea id="rule-evidence" className={styles.textarea} value={selectedRule.evidence ?? ''} onChange={(event) => updateRule('evidence', event.target.value || undefined)} /></div>
            </div>
          </>
        ) : <div className={styles.inlineEmpty}>No rules match the current filters.</div>}
      </div>
    </section>
  );
}

function LegacyRuleEditor({ base, pending, onDirtyChange, onCancel, onCreate }: LegacyWorkspaceProps) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(base)) as GameDesignRuleSet);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const diff = useMemo(() => diffRuleSets(base, draft), [base, draft]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

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
        <div className={styles.formActions}><button className={styles.primaryButton} type="button" aria-label="Create version" disabled={pending || !dirty} onClick={() => onCreate(draft)}><SaveOutlined /> Create version</button></div>
      </section>
    );
  }

  return (
    <>
      <RuleFields value={draft} onChange={setDraft} />
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.formActions}>
        <button className={styles.secondaryButton} type="button" disabled={pending} onClick={() => { if (!dirty || window.confirm('Discard this rule-set draft?')) onCancel(); }}>Cancel</button>
        <button className={styles.primaryButton} type="button" disabled={!dirty || pending} onClick={() => { try { setDraft(parseRuleSet(draft)); setError(''); setReviewing(true); } catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : 'The rule set is invalid.'); } }}>Review changes</button>
      </div>
    </>
  );
}
