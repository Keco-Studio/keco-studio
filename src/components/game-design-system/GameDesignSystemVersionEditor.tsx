'use client';

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { gameArtStyleInputSchema, type GameArtStyleInput, type NormalizedGameArtStyleInput } from '@/lib/game-art-style/schema';
import { gameDesignDocumentSchema, gameDesignRuleSetSchema, type GameDesignDocument, type GameDesignRule, type GameDesignRuleSet, type TableGuidance } from '@/lib/game-design-system/ruleSchema';
import type { CreateGameDesignSystemVersionRequest } from '@/lib/game-design-system/versionRequest';
import type { GameDesignSystemVersion } from '@/lib/services/gameDesignSystemService';
import { GameDesignSystemArtStyleFields } from './GameDesignSystemArtStyleFields';
import { GameDesignSystemDocumentEditor, gameDesignDocumentSections } from './GameDesignSystemDocumentEditor';
import { GameDesignSystemRuleEditor } from './GameDesignSystemRuleEditor';
import styles from './GameDesignSystemsPage.module.css';

const sections = ['document', 'rules', 'art-style', 'review'] as const;
type Section = typeof sections[number];
type Domain = 'document' | 'rules' | 'artStyle';

const sectionLabels: Record<Section, string> = {
  document: 'Document',
  rules: 'Rules',
  'art-style': 'Art Style',
  review: 'Review',
};

type VersionDraft = {
  document: GameDesignDocument;
  rules: GameDesignRuleSet;
  artStyle: GameArtStyleInput | null;
};

type ReviewedDraft = {
  draft: { document: GameDesignDocument; rules: GameDesignRuleSet; artStyle: NormalizedGameArtStyleInput | null };
  request: CreateGameDesignSystemVersionRequest;
};

type Recovery = {
  latest: GameDesignSystemVersion;
  selected: Record<Domain, boolean>;
};

type ValidationTarget = { domain: 'rules' | 'art-style'; path: Array<string | number> } | null;

type Props = {
  baseVersion: GameDesignSystemVersion;
  currentVersionId: string;
  pending: boolean;
  onCancel: () => void;
  onCreate: (request: CreateGameDesignSystemVersionRequest) => Promise<unknown> | unknown;
  onRefreshLatest: () => Promise<GameDesignSystemVersion>;
};

const ruleFields: Array<{ key: keyof GameDesignRule; label: string }> = [
  { key: 'id', label: 'Rule ID' },
  { key: 'kind', label: 'Kind' },
  { key: 'title', label: 'Rule title' },
  { key: 'statement', label: 'Rule statement' },
  { key: 'rationale', label: 'Rationale' },
  { key: 'appliesWhen', label: 'Applies when' },
  { key: 'severity', label: 'Severity' },
  { key: 'evidence', label: 'Evidence' },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function artInput(version: GameDesignSystemVersion): NormalizedGameArtStyleInput | null {
  if (!version.artStyle) return null;
  return gameArtStyleInputSchema.parse({
    presetId: version.artStyle.presetId,
    presetVersion: version.artStyle.presetVersion,
    customization: version.artStyle.customization,
  });
}

function initialDraft(version: GameDesignSystemVersion): VersionDraft {
  return { document: clone(version.document), rules: clone(version.rules), artStyle: null };
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not specified';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  return String(value);
}

function guidanceValue(value: TableGuidance | undefined, field: keyof TableGuidance): string {
  return display(value?.[field]);
}

function ChangeRow({ label, before, after }: { label: string; before: unknown; after: unknown }) {
  return (
    <div className={styles.versionChangeRow}>
      <dt>{label}</dt>
      <dd><span>Before</span><p>{display(before)}</p></dd>
      <dd><span>After</span><p>{display(after)}</p></dd>
    </div>
  );
}

function changedDomains(base: GameDesignSystemVersion, draft: VersionDraft): Record<Domain, boolean> {
  return {
    document: !equal(base.document, draft.document),
    rules: !equal(base.rules, draft.rules),
    artStyle: draft.artStyle !== null,
  };
}

function pairRules(beforeRules: GameDesignRule[], afterRules: GameDesignRule[]): Array<{ before?: GameDesignRule; after?: GameDesignRule }> {
  const beforeById = new Map(beforeRules.map((rule) => [rule.id, rule]));
  const afterIds = new Set(afterRules.map((rule) => rule.id));
  const consumed = new Set<GameDesignRule>();
  const pairs: Array<{ before?: GameDesignRule; after?: GameDesignRule }> = afterRules.map((after, index) => {
    let before = beforeById.get(after.id);
    if (!before) {
      const indexed = beforeRules[index];
      if (indexed && !afterIds.has(indexed.id) && !consumed.has(indexed)) before = indexed;
    }
    if (before) consumed.add(before);
    return { before, after };
  });
  for (const before of beforeRules) if (!consumed.has(before)) pairs.push({ before });
  return pairs;
}

export function GameDesignSystemVersionEditor({
  baseVersion,
  currentVersionId,
  pending,
  onCancel,
  onCreate,
  onRefreshLatest,
}: Props) {
  const [workingBase, setWorkingBase] = useState(baseVersion);
  const [workingCurrentVersionId, setWorkingCurrentVersionId] = useState(currentVersionId);
  const [draft, setDraft] = useState<VersionDraft>(() => initialDraft(baseVersion));
  const [activeSection, setActiveSection] = useState<Section>('document');
  const [reviewed, setReviewed] = useState<ReviewedDraft | null>(null);
  const [validationError, setValidationError] = useState('');
  const [validationTarget, setValidationTarget] = useState<ValidationTarget>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [rebasedVersionNumber, setRebasedVersionNumber] = useState<number | null>(null);
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const domains = useMemo(() => changedDomains(workingBase, draft), [draft, workingBase]);
  const dirty = domains.document || domains.rules || domains.artStyle;
  const originalArtStyle = useMemo(() => artInput(workingBase), [workingBase]);

  function selectSection(section: Section) {
    setValidationError('');
    setValidationTarget(null);
    setActiveSection(section);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % sections.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + sections.length) % sections.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = sections.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = sections[nextIndex];
    selectSection(next);
    tabRefs.current[next]?.focus();
  }

  function focusElement(id: string) {
    window.setTimeout(() => globalThis.document.getElementById(id)?.focus(), 0);
  }

  function updateArtStyle(next: GameArtStyleInput | null) {
    setReviewed(null);
    setRecovery(null);
    setSaveError('');
    setRefreshRequired(false);
    setValidationTarget(null);
    if (next === null) {
      setDraft((current) => ({ ...current, artStyle: null }));
      return;
    }
    const reverted = originalArtStyle && equal(next, originalArtStyle);
    setDraft((current) => ({ ...current, artStyle: reverted ? null : next }));
  }

  function review() {
    setSaveError('');
    const parsedDocument = gameDesignDocumentSchema.safeParse(draft.document);
    if (!parsedDocument.success) {
      const field = String(parsedDocument.error.issues[0]?.path[0] ?? 'designIntent');
      setValidationError('Complete every required document section.');
      setValidationTarget(null);
      setActiveSection('document');
      focusElement(`gds-document-${field}`);
      return;
    }
    const parsedRules = gameDesignRuleSetSchema.safeParse(draft.rules);
    if (!parsedRules.success) {
      setValidationError(parsedRules.error.issues[0]?.message ?? 'Review the rule fields.');
      setValidationTarget({ domain: 'rules', path: parsedRules.error.issues[0]?.path ?? [] });
      setActiveSection('rules');
      return;
    }
    const parsedArt = draft.artStyle === null ? null : gameArtStyleInputSchema.safeParse(draft.artStyle);
    if (parsedArt && !parsedArt.success) {
      setValidationError(parsedArt.error.issues[0]?.message ?? 'Review the Art Style fields.');
      setValidationTarget({ domain: 'art-style', path: parsedArt.error.issues[0]?.path ?? [] });
      setActiveSection('art-style');
      return;
    }

    const normalized: ReviewedDraft['draft'] = {
      document: parsedDocument.data,
      rules: parsedRules.data,
      artStyle: parsedArt?.data ?? null,
    };
    const documentChanged = !equal(normalized.document, workingBase.document);
    const rulesChanged = !equal(normalized.rules, workingBase.rules);
    const artChanged = normalized.artStyle !== null && !equal(normalized.artStyle, artInput(workingBase));
    if (!documentChanged && !rulesChanged && !artChanged) {
      setDraft(initialDraft(workingBase));
      setValidationError('The draft does not contain any changes.');
      return;
    }
    const request: CreateGameDesignSystemVersionRequest = {
      parentVersionId: workingBase.id,
      expectedCurrentVersionId: workingCurrentVersionId,
      ...(documentChanged ? { document: normalized.document } : {}),
      ...(rulesChanged ? { rules: normalized.rules } : {}),
      ...(artChanged ? { artStyle: normalized.artStyle! } : {}),
    };
    setDraft({ ...normalized, artStyle: artChanged ? normalized.artStyle : null });
    setReviewed({ draft: normalized, request });
    setValidationError('');
    setValidationTarget(null);
    setActiveSection('review');
    focusElement('gds-version-review-heading');
  }

  async function refreshLatest() {
    setSaving(true);
    setSaveError('');
    try {
      const latest = await onRefreshLatest();
      const request = reviewed?.request;
      setRecovery({
        latest,
        selected: {
          document: Boolean(request?.document),
          rules: Boolean(request?.rules),
          artStyle: request?.artStyle !== undefined,
        },
      });
      setRefreshRequired(true);
      setSaveError(`Version ${latest.version_number} is now current. Select which draft domains to copy into a fresh draft.`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to refresh the latest version.');
      setRecovery(null);
      setRefreshRequired(true);
    } finally {
      setSaving(false);
    }
  }

  async function createVersion() {
    if (!reviewed) return;
    setSaving(true);
    setSaveError('');
    try {
      await onCreate(reviewed.request);
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'VERSION_STALE') {
        setRefreshRequired(true);
        await refreshLatest();
      } else {
        setRefreshRequired(false);
        setSaveError(error instanceof Error ? error.message : 'Failed to create the version.');
        setSaving(false);
      }
      return;
    }
    setSaving(false);
  }

  function startFreshDraft() {
    if (!recovery || !reviewed) return;
    const { latest, selected } = recovery;
    const copiedArt = selected.artStyle && reviewed.request.artStyle && reviewed.request.artStyle !== null
      ? reviewed.request.artStyle
      : null;
    const latestArt = artInput(latest);
    setWorkingBase(latest);
    setWorkingCurrentVersionId(latest.id);
    setDraft({
      document: selected.document ? clone(reviewed.draft.document) : clone(latest.document),
      rules: selected.rules ? clone(reviewed.draft.rules) : clone(latest.rules),
      artStyle: copiedArt && !equal(copiedArt, latestArt) ? clone(copiedArt) : null,
    });
    setReviewed(null);
    setRecovery(null);
    setRefreshRequired(false);
    setSaveError('');
    setValidationError('');
    setValidationTarget(null);
    setRebasedVersionNumber(latest.version_number);
    setActiveSection('document');
    focusElement('gds-version-document-heading');
  }

  function cancel() {
    if (!dirty || window.confirm('Discard this version draft?')) onCancel();
  }

  const busy = pending || saving;
  const panelId = `gds-version-panel-${activeSection}`;
  const tabId = `gds-version-tab-${activeSection}`;

  return (
    <section className={styles.versionEditor} aria-label="Create Game Design System version">
      <header className={styles.versionEditorHeader}>
        <div><span className={styles.eyebrow}>Version iteration</span><h1>Create new version</h1><p>{rebasedVersionNumber ? `Based on current version ${rebasedVersionNumber}` : `Based on version ${workingBase.version_number}`}</p><p>Nothing changes until you confirm the reviewed draft.</p></div>
        <button className={styles.secondaryButton} type="button" aria-label="Cancel version draft" disabled={busy} onClick={cancel}>Cancel</button>
      </header>

      <ol className={styles.versionWorkflowSteps} aria-label="Version iteration steps">
        <li><strong>1. Edit Document</strong><span>Background, intent, loop and presentation</span></li>
        <li><strong>2. Edit Rules</strong><span>Add, remove, reorder and refine rules or table guidance</span></li>
        <li><strong>3. Edit Art Style</strong><span>Preset, art direction, references and avoid guidance</span></li>
        <li><strong>4. Review &amp; create</strong><span>Inspect Before / After, then save the immutable version</span></li>
      </ol>

      {workingBase.id !== workingCurrentVersionId && rebasedVersionNumber === null ? <div className={styles.notice} role="status">Version {workingBase.version_number} is historical. The current version will still be checked before creation.</div> : null}

      <nav className={styles.versionEditorTabs} role="tablist" aria-label="Version editor sections">
        {sections.map((section, index) => <button
          key={section}
          ref={(element) => { tabRefs.current[section] = element; }}
          id={`gds-version-tab-${section}`}
          type="button"
          role="tab"
          aria-controls={`gds-version-panel-${section}`}
          aria-selected={activeSection === section}
          tabIndex={activeSection === section ? 0 : -1}
          className={activeSection === section ? styles.versionEditorTabActive : styles.versionEditorTab}
          onClick={() => selectSection(section)}
          onKeyDown={(event) => handleTabKeyDown(event, index)}
        >{sectionLabels[section]}</button>)}
      </nav>
      <label className={styles.versionEditorSectionSelect}>Editor section<select className={styles.select} value={activeSection} onChange={(event) => selectSection(event.target.value as Section)}>{sections.map((section) => <option key={section} value={section}>{sectionLabels[section]}</option>)}</select></label>

      <div id={panelId} className={styles.versionEditorPanel} role="tabpanel" aria-labelledby={tabId} aria-label={sectionLabels[activeSection]}>
        {activeSection === 'document' ? <GameDesignSystemDocumentEditor value={draft.document} onChange={(documentValue) => { setReviewed(null); setRecovery(null); setSaveError(''); setRefreshRequired(false); setValidationTarget(null); setDraft((current) => ({ ...current, document: documentValue })); }} /> : null}
        {activeSection === 'rules' ? <GameDesignSystemRuleEditor value={draft.rules} focusPath={validationTarget?.domain === 'rules' ? validationTarget.path : null} onChange={(rulesValue) => { setReviewed(null); setRecovery(null); setSaveError(''); setRefreshRequired(false); setValidationTarget(null); setDraft((current) => ({ ...current, rules: rulesValue })); }} /> : null}
        {activeSection === 'art-style' ? <GameDesignSystemArtStyleFields originalSnapshot={workingBase.artStyle} artStyleReadError={workingBase.artStyleReadError} value={draft.artStyle} changed={domains.artStyle} focusPath={validationTarget?.domain === 'art-style' ? validationTarget.path : null} onChange={updateArtStyle} /> : null}
        {activeSection === 'review' ? (
          <section className={styles.versionReview} aria-labelledby="gds-version-review-heading">
            <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Review</span><h2 id="gds-version-review-heading" tabIndex={-1}>Version changes</h2></div></div>
            {!reviewed ? <div className={styles.inlineEmpty}>No reviewed draft yet. Return to an editor section and choose Review changes.</div> : <VersionReview base={workingBase} reviewed={reviewed} />}
            {saveError ? <div className={styles.error} role="alert">{saveError}</div> : null}
            {recovery ? (
              <div className={styles.staleRecovery}>
                {(['document', 'rules', 'artStyle'] as Domain[]).map((domain) => {
                  const supplied = domain === 'document' ? reviewed?.request.document !== undefined : domain === 'rules' ? reviewed?.request.rules !== undefined : reviewed?.request.artStyle !== undefined;
                  if (!supplied) return null;
                  const label = domain === 'artStyle' ? 'Art Style' : domain[0].toUpperCase() + domain.slice(1);
                  return <label key={domain}><input type="checkbox" checked={recovery.selected[domain]} onChange={(event) => setRecovery((current) => current ? { ...current, selected: { ...current.selected, [domain]: event.target.checked } } : current)} /> Copy {label} changes</label>;
                })}
                <button className={styles.primaryButton} type="button" disabled={!Object.values(recovery.selected).some(Boolean)} onClick={startFreshDraft}>Start fresh draft</button>
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => { setActiveSection('document'); focusElement('gds-version-document-heading'); }}>Back to editor</button>
              {saveError && refreshRequired && !recovery && reviewed ? <button className={styles.secondaryButton} type="button" disabled={busy} aria-label="Retry latest version" onClick={() => void refreshLatest()}><ReloadOutlined /> Retry latest version</button> : null}
              <button className={styles.primaryButton} type="button" aria-label="Create version" disabled={!reviewed || busy || Boolean(recovery)} onClick={() => void createVersion()}><SaveOutlined /> Create version</button>
            </div>
          </section>
        ) : null}
      </div>

      {validationError ? <div className={styles.error} role="alert">{validationError}</div> : null}
      {activeSection !== 'review' ? <div className={styles.versionEditorActions}><span>{dirty ? 'Unsaved draft changes' : 'No changes yet'}</span><button className={styles.primaryButton} type="button" disabled={!dirty || busy} onClick={review}>Review changes</button></div> : null}
    </section>
  );
}

function VersionReview({ base, reviewed }: { base: GameDesignSystemVersion; reviewed: ReviewedDraft }) {
  const documentChanged = reviewed.request.document !== undefined;
  const rulesChanged = reviewed.request.rules !== undefined;
  const artChanged = reviewed.request.artStyle !== undefined && reviewed.request.artStyle !== null;
  const nextRules = reviewed.draft.rules;
  const nextArt = reviewed.draft.artStyle;
  return (
    <div className={styles.versionReviewDomains}>
      {documentChanged ? <section aria-label="Document changes"><h3>Document</h3><dl>{gameDesignDocumentSections.map((section) => equal(base.document[section.key], reviewed.draft.document[section.key]) ? null : <ChangeRow key={section.key} label={section.label} before={base.document[section.key]} after={reviewed.draft.document[section.key]} />)}</dl></section> : null}
      {rulesChanged ? <section aria-label="Rules changes"><h3>Rules</h3><dl>
        {!equal(base.rules.genres, nextRules.genres) ? <ChangeRow label="Genres" before={base.rules.genres} after={nextRules.genres} /> : null}
        {!equal(base.rules.philosophies, nextRules.philosophies) ? <ChangeRow label="Philosophies" before={base.rules.philosophies} after={nextRules.philosophies} /> : null}
        {!equal(base.rules.suitableFor, nextRules.suitableFor) ? <ChangeRow label="Suitable for" before={base.rules.suitableFor} after={nextRules.suitableFor} /> : null}
        {pairRules(base.rules.rules, nextRules.rules).map(({ before, after }, index) => {
          return ruleFields.map((field) => equal(before?.[field.key], after?.[field.key]) ? null : <ChangeRow key={`${index}-${field.key}`} label={`Rule ${index + 1} / ${field.label}`} before={before?.[field.key]} after={after?.[field.key]} />);
        })}
        {Array.from({ length: Math.max(base.rules.tableGuidance.length, nextRules.tableGuidance.length) }, (_, index) => {
          const before = base.rules.tableGuidance[index];
          const after = nextRules.tableGuidance[index];
          return (['table', 'purpose', 'fields'] as Array<keyof TableGuidance>).map((field) => guidanceValue(before, field) === guidanceValue(after, field) ? null : <ChangeRow key={`guidance-${index}-${field}`} label={`Table ${index + 1} / ${field}`} before={guidanceValue(before, field)} after={guidanceValue(after, field)} />);
        })}
      </dl></section> : null}
      {artChanged && nextArt ? <section aria-label="Art Style changes"><h3>Art Style</h3>{base.artStyleReadError ? <p className={styles.notice}>This replaces the inherited unsupported Art Style snapshot.</p> : null}<dl>
        <ChangeRow label="Preset" before={base.artStyle ? `${base.artStyle.title} @ ${base.artStyle.presetVersion}` : undefined} after={`${nextArt.presetId} @ ${nextArt.presetVersion}`} />
        <ChangeRow label="Custom art direction" before={base.artStyle?.customization.direction} after={nextArt.customization.direction} />
        <ChangeRow label="Visual references" before={base.artStyle?.customization.referenceGames.map((reference) => `${reference.name}: ${reference.borrow}`)} after={nextArt.customization.referenceGames.map((reference) => `${reference.name}: ${reference.borrow}`)} />
        <ChangeRow label="Visual avoid guidance" before={base.artStyle?.customization.avoid} after={nextArt.customization.avoid} />
      </dl></section> : null}
    </div>
  );
}
