'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import {
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  SaveOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { GameDesignDocument, GameDesignRule } from '@/lib/game-design-system/ruleSchema';
import type { CreateGameDesignSystemVersionRequest } from '@/lib/game-design-system/versionRequest';
import type {
  GameDesignSystemDetail,
  GameDesignSystemStatus,
  GameDesignSystemVersion,
} from '@/lib/services/gameDesignSystemService';
import type { PublicGddGenerationJob } from '@/lib/services/gddGenerationService';
import {
  applyProjectGameDesignSystem,
  cancelProjectGddGeneration,
  clearProjectGameDesignSystem,
  createGameDesignSystemVersion,
  deleteGameDesignSystem,
  fetchGameDesignSystem,
  fetchProjectGameDesignSystem,
  fetchLatestProjectGddGenerationJob,
  fetchProjectGddGenerationJob,
  startProjectGddGeneration,
  updateGameDesignSystemDraft,
} from '@/lib/services/gameDesignSystemClient';
import { queryKeys } from '@/lib/utils/queryKeys';
import { GameArtStylePreview } from './GameArtStylePreview';
import { GameDesignSystemVersionEditor } from './GameDesignSystemVersionEditor';
import { GddGenerationDialog, type GddGenerationOptions } from './GddGenerationDialog';
import styles from './GameDesignSystemsPage.module.css';

export type GameDesignSystemView = 'overview' | 'art-style' | 'rules' | 'versions' | 'sources' | 'projects';
export type ProjectOption = { id: string; name: string };
type Feedback = { tone: 'success' | 'error'; text: string };

const views: Array<{ id: GameDesignSystemView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'art-style', label: 'Art Style' },
  { id: 'rules', label: 'Rules' },
  { id: 'versions', label: 'Versions' },
  { id: 'sources', label: 'Sources' },
  { id: 'projects', label: 'Projects' },
];

const ruleKindLabels: Record<GameDesignRule['kind'], string> = {
  principle: 'Design principles',
  constraint: 'Constraints',
  pattern: 'Design patterns',
  anti_pattern: 'Anti-patterns',
  check: 'Checks',
};

type Props = {
  detail: GameDesignSystemDetail;
  viewerUserId: string;
  projects: ProjectOption[];
  projectsLoading: boolean;
  projectsError: boolean;
  onRetryProjects: () => void;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

function versionHasConflicts(version: GameDesignSystemVersion | null): boolean {
  return Boolean(version && version.conflicts.length > 0);
}

function formatDate(value: string): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

const gddPhaseLabels: Record<PublicGddGenerationJob['phase'], string> = {
  collecting: 'Collecting sources',
  planning: 'Planning structure',
  generating_core: 'Writing core design',
  generating_systems: 'Writing systems',
  generating_content: 'Writing content',
  reviewing: 'Reviewing consistency',
  repairing: 'Repairing draft',
  generating: 'Writing draft',
  validating: 'Validating output',
  saving: 'Saving document',
  completed: 'Completed',
  failed: 'Stopped',
};

function VersionContext({ detail, version }: { detail: GameDesignSystemDetail; version: GameDesignSystemVersion }) {
  const parent = version.parent_version_id
    ? detail.versions.find((candidate) => candidate.id === version.parent_version_id) ?? null
    : null;
  return (
    <div className={styles.versionContext}>
      <strong>{parent ? 'Based on version ' + parent.version_number : version.parent_version_id ? 'Based on external version ' + version.parent_version_id.slice(0, 8) : 'Initial version'}</strong>
      {version.diff.added.length ? <span>Added: {version.diff.added.join(', ')}</span> : null}
      {version.diff.removed.length ? <span>Removed: {version.diff.removed.join(', ')}</span> : null}
      {version.diff.changed.length ? <span>Changed: {version.diff.changed.join(', ')}</span> : null}
      {version.conflicts.map((conflict) => <span className={styles.conflictText} key={conflict.ruleId + conflict.reason}>{conflict.ruleId}: {conflict.reason}</span>)}
    </div>
  );
}

const documentSections: Array<{ key: keyof GameDesignDocument; label: string; eyebrow: string }> = [
  { key: 'coreLoop', label: 'Core loop', eyebrow: 'Play rhythm' },
  { key: 'decisionStructure', label: 'Decision structure', eyebrow: 'Player agency' },
  { key: 'systemBoundaries', label: 'Rules and system boundaries', eyebrow: 'System contract' },
  { key: 'progressionEconomy', label: 'Progression and economy', eyebrow: 'Long-term structure' },
  { key: 'contentModel', label: 'Content model', eyebrow: 'Production model' },
  { key: 'difficultyBalance', label: 'Difficulty and balance', eyebrow: 'Challenge model' },
  { key: 'experiencePresentation', label: 'Experience and presentation', eyebrow: 'Player-facing clarity' },
];

function OverviewView(props: {
  detail: GameDesignSystemDetail;
  version: GameDesignSystemVersion | null;
  canEdit: boolean;
  onStartVersion: () => void;
}) {
  if (!props.version) return <div className={styles.workspaceState}>This system has no available versions.</div>;
  return (
    <section className={styles.documentView} role="tabpanel">
      <div className={styles.documentHeading}>
        <div><span className={styles.eyebrow}>Human-readable system</span><h2 id="gds-document-heading" tabIndex={-1}>Design document</h2><p>Version {props.version.version_number} / {props.version.rules.suitableFor}</p></div>
        {props.canEdit ? <button className={styles.secondaryButton} type="button" aria-label="Iterate from document view" onClick={props.onStartVersion}><EditOutlined /> Iterate this version</button> : null}
      </div>
      <section className={styles.gameBackgroundReading}>
        <span className={styles.eyebrow}>World context</span>
        <h3>Game Background &amp; Setting</h3>
        <p>{props.version.document.gameBackground || 'Not specified'}</p>
      </section>
      <div className={styles.documentLead}>
        <section>
          <span className={styles.eyebrow}>Design intent</span>
          <h3>What this system is trying to achieve</h3>
          <p>{props.version.document.designIntent}</p>
        </section>
        <section>
          <span className={styles.eyebrow}>Player fantasy</span>
          <h3>Who the player gets to be</h3>
          <p>{props.version.document.playerFantasy}</p>
        </section>
      </div>
      <div className={styles.documentBody}>{documentSections.map((section) => (
        <section key={section.key}>
          <span className={styles.eyebrow}>{section.eyebrow}</span>
          <h3>{section.label}</h3>
          <p>{props.version!.document[section.key]}</p>
        </section>
      ))}</div>
      <footer className={styles.documentMeta}>Version {props.version.version_number} / {props.detail.versions.length} saved versions / {props.version.rules.rules.length} structured rules</footer>
    </section>
  );
}

function ArtStyleView({ version, canEdit, onStartVersion }: { version: GameDesignSystemVersion | null; canEdit: boolean; onStartVersion: () => void }) {
  return (
    <section className={styles.artStyleView} role="tabpanel">
      {canEdit ? <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Read-only snapshot</span><h2>Want to change the visual direction?</h2><p>Start a version iteration to choose a new preset or update art direction.</p></div><button className={styles.secondaryButton} type="button" aria-label="Iterate from Art Style view" onClick={onStartVersion}><EditOutlined /> Iterate this version</button></div> : null}
      {version?.artStyleReadError
        ? <div className={styles.inlineEmpty}>This version contains an unsupported Art Style snapshot. It remains inherited exactly until explicitly replaced.</div>
        : !version?.artStyle
          ? <div className={styles.inlineEmpty}>No art style specified</div>
        : <GameArtStylePreview snapshot={version.artStyle} mode="browse" showCustomization />}
    </section>
  );
}

function RulesView(props: {
  detail: GameDesignSystemDetail;
  version: GameDesignSystemVersion | null;
  canEdit: boolean;
  onStartVersion: () => void;
}) {
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const selectedRule = props.version?.rules.rules.find((rule) => rule.id === selectedRuleId)
    ?? props.version?.rules.rules[0]
    ?? null;

  if (!props.version) return <div className={styles.workspaceState}>This system has no available versions.</div>;
  return (
    <section className={styles.rulesWorkbench} role="tabpanel">
      <aside className={styles.ruleOutline} aria-label="Rule outline">
        {Object.entries(ruleKindLabels).map(([kind, label]) => {
          const rules = props.version!.rules.rules.filter((rule) => rule.kind === kind);
          if (!rules.length) return null;
          return (
            <div className={styles.outlineGroup} key={kind}>
              <span>{label} <b>{rules.length}</b></span>
              {rules.map((rule) => <button className={rule.id === selectedRule?.id ? styles.outlineButtonActive : styles.outlineButton} type="button" key={rule.id} onClick={() => setSelectedRuleId(rule.id)}>{rule.title}</button>)}
            </div>
          );
        })}
      </aside>
      <article className={styles.ruleReading}>
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>{selectedRule ? ruleKindLabels[selectedRule.kind] : 'Rule'}</span><h3>{selectedRule?.title || 'No rule selected'}</h3><p>This is a read-only snapshot. Add or refine rules from a new version iteration.</p></div>
          {props.canEdit ? <button className={styles.secondaryButton} type="button" aria-label="Iterate from Rules view" onClick={props.onStartVersion}><EditOutlined /> Iterate this version</button> : null}
        </div>
        {selectedRule ? (
          <>
            <code className={styles.ruleId}>{selectedRule.id}</code>
            <p className={styles.ruleStatement}>{selectedRule.statement}</p>
            <dl className={styles.ruleDetails}>
              <div><dt>Severity</dt><dd>{selectedRule.severity}</dd></div>
              <div><dt>Applies when</dt><dd>{selectedRule.appliesWhen}</dd></div>
              {selectedRule.rationale ? <div><dt>Rationale</dt><dd>{selectedRule.rationale}</dd></div> : null}
              {selectedRule.evidence ? <div><dt>Evidence</dt><dd>{selectedRule.evidence}</dd></div> : null}
            </dl>
          </>
        ) : null}
      </article>
      <aside className={styles.ruleContext}>
        <span className={styles.eyebrow}>Rule-set context</span>
        <h3>Version {props.version.version_number}</h3>
        <dl>
          <div><dt>Genres</dt><dd>{props.version.rules.genres.join(', ') || 'Not specified'}</dd></div>
          <div><dt>Philosophies</dt><dd>{props.version.rules.philosophies.join(', ') || 'Not specified'}</dd></div>
          <div><dt>Suitable for</dt><dd>{props.version.rules.suitableFor}</dd></div>
        </dl>
        <h4>Table Guidance</h4>
        {props.version.rules.tableGuidance.length ? <div className={styles.ruleGuidanceReading}>{props.version.rules.tableGuidance.map((item) => <div key={item.table}><strong>{item.table}</strong><span>{item.purpose}</span><small>{item.fields.join(', ') || 'No fields recorded'}</small></div>)}</div> : <p>No table guidance.</p>}
        <VersionContext detail={props.detail} version={props.version} />
        <dl>
          <div><dt>Rules</dt><dd>{props.version.rules.rules.length}</dd></div>
          <div><dt>Sources</dt><dd>{props.version.source_snapshots.length}</dd></div>
          <div><dt>Conflicts</dt><dd>{props.version.conflicts.length}</dd></div>
        </dl>
      </aside>
    </section>
  );
}

function VersionsView({ detail, selectedVersionId, onSelect, canEdit, onStartVersion }: { detail: GameDesignSystemDetail; selectedVersionId: string; onSelect: (id: string) => void; canEdit: boolean; onStartVersion: () => void }) {
  return (
    <section className={styles.viewPanel} role="tabpanel">
      <div className={styles.sectionHeading}>
        <div><span className={styles.eyebrow}>Immutable history</span><h3>{detail.versions.length} saved {detail.versions.length === 1 ? 'version' : 'versions'}</h3><p>Select a version to inspect it, or start a new iteration from the selected snapshot.</p></div>
        {canEdit ? <button className={styles.primaryButton} type="button" onClick={onStartVersion}><EditOutlined /> Start version iteration</button> : null}
      </div>
      <div className={styles.versionList}>
        {detail.versions.map((version) => (
          <article className={version.id === selectedVersionId ? styles.versionRowActive : styles.versionRow} key={version.id}>
            <button type="button" onClick={() => onSelect(version.id)}>
              <span><h3>Version {version.version_number}</h3>{version.id === detail.current_version_id ? <span className={styles.badgeBlue}>Current</span> : null}</span>
              <small>{formatDate(version.created_at)} / {version.created_by || 'Unknown author'}</small>
            </button>
            <div className={styles.diffMetricsCompact}>
              <span>+{version.diff.added.length}</span><span>~{version.diff.changed.length}</span><span>-{version.diff.removed.length}</span><span className={version.conflicts.length ? styles.conflictText : ''}>{version.conflicts.length} conflicts</span>
            </div>
            {'schemaVersion' in version.diff ? <div className={styles.versionDomainChanges}>
              <span>Document: {version.diff.document.changedSections.length ? version.diff.document.changedSections.join(', ') : 'unchanged'}</span>
              <span>Rules settings: {version.diff.ruleSetSettingsChanged ? 'changed' : 'unchanged'}</span>
              <span>Table Guidance: {version.diff.tableGuidanceChanged ? 'changed' : 'unchanged'}</span>
              <span>Art Style: {version.diff.artStyle.change.replaceAll('_', ' ')}</span>
            </div> : <div className={styles.versionDomainChanges}><span>Document: not recorded</span><span>Rules settings: not recorded</span><span>Table Guidance: not recorded</span><span>Art Style: not recorded</span></div>}
            <VersionContext detail={detail} version={version} />
            <code className={styles.hash}>{version.content_hash}</code>
          </article>
        ))}
      </div>
    </section>
  );
}

function SourcesView({ version }: { version: GameDesignSystemVersion | null }) {
  return (
    <section className={styles.viewPanel} role="tabpanel">
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Immutable evidence</span><h3>Source snapshots</h3><p>Snapshot metadata is shown exactly as authorized by the server.</p></div></div>
      {!version || version.source_snapshots.length === 0 ? <div className={styles.inlineEmpty}>No source snapshots for this version.</div> : (
        <div className={styles.sourceList}>{version.source_snapshots.map((source) => (
          <article className={styles.sourceRow} key={source.kind + ':' + (source.resourceId || source.contentHash)}>
            <span className={styles.sourceKind}>{source.kind === 'table' ? 'Keco table' : source.kind === 'document' ? 'Document' : 'Legacy Markdown'}</span>
            <div><strong>{source.label}</strong><small>{source.byteCount} bytes / SHA-256 {source.contentHash}{source.truncated ? ' / Truncated' : ''}</small></div>
            <time>{source.updatedAt ? formatDate(source.updatedAt) : 'Snapshot time unavailable'}</time>
          </article>
        ))}</div>
      )}
    </section>
  );
}

function ProjectsView(props: {
  detail: GameDesignSystemDetail;
  version: GameDesignSystemVersion | null;
  projects: ProjectOption[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onFeedback: (feedback: Feedback) => void;
}) {
  const queryClient = useQueryClient();
  const { onFeedback } = props;
  const [projectId, setProjectId] = useState('');
  const [gddJobs, setGddJobs] = useState<Record<string, PublicGddGenerationJob>>({});
  const [generationProjectId, setGenerationProjectId] = useState<string | null>(null);
  const bindingQueries = useQueries({
    queries: props.projects.map((project) => ({
      queryKey: queryKeys.projectGameDesignSystem(project.id),
      queryFn: () => fetchProjectGameDesignSystem(project.id),
      retry: false,
    })),
  });
  const applyMutation = useMutation({
    mutationFn: (targetProjectId: string) => applyProjectGameDesignSystem(targetProjectId, props.detail.id, props.version!.id),
    onSuccess: (_system, targetProjectId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectGameDesignSystem(targetProjectId) });
      onFeedback({ tone: 'success', text: 'Version ' + props.version!.version_number + ' applied to project.' });
    },
    onError: (error) => onFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to apply version.' }),
  });
  const clearMutation = useMutation({
    mutationFn: (targetProjectId: string) => clearProjectGameDesignSystem(targetProjectId),
    onSuccess: (_result, targetProjectId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectGameDesignSystem(targetProjectId) });
      onFeedback({ tone: 'success', text: 'Project binding removed.' });
    },
    onError: (error) => onFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to remove project binding.' }),
  });
  const generateGddMutation = useMutation({
    mutationFn: ({ targetProjectId, options }: { targetProjectId: string; options: GddGenerationOptions }) => startProjectGddGeneration(targetProjectId, props.detail.id, props.version!.id, options),
    onSuccess: (job, variables) => {
      const { targetProjectId } = variables;
      setGddJobs((current) => ({ ...current, [targetProjectId]: job }));
      setGenerationProjectId(null);
      if (job.status === 'completed') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.documents(targetProjectId) });
        onFeedback({ tone: 'success', text: 'GDD draft created.' });
      } else {
        onFeedback({ tone: 'success', text: 'GDD generation started.' });
      }
    },
    onError: (error) => onFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to start GDD generation.' }),
  });
  const cancelGddMutation = useMutation({
    mutationFn: ({ targetProjectId, jobId }: { targetProjectId: string; jobId: string }) => cancelProjectGddGeneration(targetProjectId, jobId),
    onSuccess: (job, variables) => {
      setGddJobs((current) => ({ ...current, [variables.targetProjectId]: job }));
      onFeedback({ tone: 'success', text: 'GDD generation stopped.' });
    },
    onError: (error) => onFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to stop GDD generation.' }),
  });

  useEffect(() => {
    if (!props.version || typeof fetchLatestProjectGddGenerationJob !== 'function') return undefined;
    let cancelled = false;
    void Promise.all(props.projects.map(async (project) => {
      try {
        return [project.id, await fetchLatestProjectGddGenerationJob(project.id, props.detail.id, props.version!.id)] as const;
      } catch {
        return null;
      }
    })).then((results) => {
      if (cancelled) return;
      setGddJobs((current) => {
        const next = { ...current };
        for (const result of results) if (result?.[1]) next[result[0]] = result[1];
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [props.detail.id, props.projects, props.version]);

  useEffect(() => {
    const active = Object.entries(gddJobs).filter(([, job]) => job.status === 'queued' || job.status === 'running');
    if (active.length === 0) return undefined;
    const timer = window.setInterval(async () => {
      const updates = await Promise.all(active.map(async ([targetProjectId, job]) => {
        try {
          return [targetProjectId, await fetchProjectGddGenerationJob(targetProjectId, job.id)] as const;
        } catch {
          return null;
        }
      }));
      for (const update of updates) {
        if (!update || !update[1]) continue;
        const [targetProjectId, job] = update;
        const previous = gddJobs[targetProjectId];
        if (job.status === 'completed' && previous?.status !== 'completed') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.documents(targetProjectId) });
          onFeedback({ tone: 'success', text: 'GDD draft created.' });
        } else if (job.status === 'failed' && previous?.status !== 'failed') {
          onFeedback({ tone: 'error', text: job.error || 'GDD generation failed.' });
        }
      }
      setGddJobs((current) => {
        const next = { ...current };
        for (const update of updates) {
          if (!update || !update[1]) continue;
          const [targetProjectId, job] = update;
          next[targetProjectId] = job;
        }
        return next;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [gddJobs, onFeedback, queryClient]);
  const cannotApply = !projectId || !props.version || props.detail.migration_status !== 'ready' || versionHasConflicts(props.version) || applyMutation.isPending;

  return (
    <section className={styles.viewPanel} role="tabpanel">
      <div className={styles.sectionHeading}>
        <div><span className={styles.eyebrow}>Project bindings</span><h3>Apply a pinned version</h3><p>Projects keep the selected immutable version until it is explicitly replaced.</p></div>
      </div>
      <div className={styles.applyBar}>
        <select className={styles.select} value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Select project">
          <option value="">Select project</option>
          {props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button className={styles.primaryButton} type="button" disabled={cannotApply} title={versionHasConflicts(props.version) ? 'Versions with conflicts cannot be applied.' : undefined} onClick={() => applyMutation.mutate(projectId)}>Use version {props.version?.version_number ?? ''}</button>
        {props.error ? <button className={styles.secondaryButton} type="button" onClick={props.onRetry}><ReloadOutlined /> Retry projects</button> : null}
      </div>
      {versionHasConflicts(props.version) ? <div className={styles.error} role="alert">Resolve version conflicts before applying this version.</div> : null}
      {props.loading ? <div className={styles.skeleton} /> : null}
      {!props.loading && !props.error && props.projects.length === 0 ? <div className={styles.inlineEmpty}>No projects are available.</div> : null}
      <div className={styles.projectList}>
        {props.projects.map((project, index) => {
          const bindingQuery = bindingQueries[index];
          const binding = bindingQuery.data ?? null;
          const selectedVersionIsBound = binding?.id === props.detail.id && binding.current_version?.id === props.version?.id;
          const gddJob = gddJobs[project.id];
          const generating = gddJob?.status === 'queued' || gddJob?.status === 'running';
          return (
            <article className={styles.projectRow} key={project.id}>
              <div><strong>{project.name}</strong><small>{bindingQuery.isLoading ? 'Loading binding...' : bindingQuery.isError ? 'Binding unavailable' : binding ? binding.title + ' / Version ' + (binding.current_version?.version_number ?? 'unknown') : 'No Game Design System applied'}{generating ? ' / GDD: ' + gddPhaseLabels[gddJob.phase] : ''}</small></div>
              <div className={styles.projectActions}>
                {gddJob?.status === 'completed' && gddJob.output_document_id ? <a className={styles.secondaryButton} href={`/${project.id}/doc/${gddJob.output_document_id}`}>Open GDD Document</a> : null}
                {selectedVersionIsBound ? <button className={styles.primaryButton} type="button" disabled={generating || generateGddMutation.isPending} onClick={() => setGenerationProjectId(project.id)}>{generating ? 'Generating GDD...' : gddJob?.status === 'failed' ? 'Retry GDD Draft' : 'Generate GDD Draft'}</button> : null}
                {generating ? <button className={styles.secondaryButton + ' ' + styles.dangerButton} type="button" aria-label="Stop GDD generation" disabled={cancelGddMutation.isPending} onClick={() => cancelGddMutation.mutate({ targetProjectId: project.id, jobId: gddJob.id })}><StopOutlined /> Stop</button> : null}
                {binding ? <button className={styles.secondaryButton + ' ' + styles.dangerButton} type="button" disabled={clearMutation.isPending || generating} onClick={() => { if (window.confirm('Remove the Game Design System from this project?')) clearMutation.mutate(project.id); }}><DeleteOutlined /> Remove</button> : <button className={styles.secondaryButton} type="button" disabled={!props.version || versionHasConflicts(props.version) || applyMutation.isPending} onClick={() => applyMutation.mutate(project.id)}>Apply selected</button>}
              </div>
            </article>
          );
        })}
      </div>
      <GddGenerationDialog
        open={Boolean(generationProjectId)}
        projectName={props.projects.find((project) => project.id === generationProjectId)?.name ?? 'Project'}
        pending={generateGddMutation.isPending}
        onCancel={() => setGenerationProjectId(null)}
        onSubmit={(options) => { if (generationProjectId) generateGddMutation.mutate({ targetProjectId: generationProjectId, options }); }}
      />
    </section>
  );
}

export function GameDesignSystemWorkspace(props: Props) {
  const queryClient = useQueryClient();
  const detail = props.detail;
  const { onDirtyChange } = props;
  const [view, setView] = useState<GameDesignSystemView>('overview');
  const [selectedVersionId, setSelectedVersionId] = useState(detail.current_version?.id ?? detail.versions[0]?.id ?? '');
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [editingVersion, setEditingVersion] = useState(false);
  const versionActionRef = useRef<HTMLButtonElement | null>(null);
  const versionIdempotencyKeyRef = useRef(crypto.randomUUID());
  const [metadataDraft, setMetadataDraft] = useState<{ title: string; summary: string; status: GameDesignSystemStatus }>({ title: detail.title, summary: detail.summary ?? '', status: detail.status });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const selectedVersion = detail.versions.find((version) => version.id === selectedVersionId)
    ?? detail.current_version
    ?? detail.versions[0]
    ?? null;
  const owned = detail.source === 'user' && detail.owner_id === props.viewerUserId;
  const metadataDirty = editingMetadata && (
    metadataDraft.title !== detail.title
    || metadataDraft.summary !== (detail.summary ?? '')
    || metadataDraft.status !== detail.status
  );
  const draftDirty = metadataDirty;
  const resetMetadataDraft = () => setMetadataDraft({
    title: detail.title,
    summary: detail.summary ?? '',
    status: detail.status,
  });

  useEffect(() => {
    onDirtyChange(draftDirty);
    return () => onDirtyChange(false);
  }, [draftDirty, onDirtyChange]);

  const confirmDiscardDraft = () => !draftDirty || window.confirm('Discard unsaved Game Design System changes?');

  const changeView = (nextView: GameDesignSystemView) => {
    if (nextView === view || !confirmDiscardDraft()) return;
    setEditingMetadata(false);
    resetMetadataDraft();
    setView(nextView);
  };

  const changeVersion = (nextVersionId: string) => {
    if (nextVersionId === selectedVersion?.id || !confirmDiscardDraft()) return;
    setEditingMetadata(false);
    resetMetadataDraft();
    setSelectedVersionId(nextVersionId);
  };

  const metadataMutation = useMutation({
    mutationFn: () => updateGameDesignSystemDraft(detail.id, { title: metadataDraft.title.trim(), summary: metadataDraft.summary.trim() || null, status: metadataDraft.status }),
    onSuccess: (system) => {
      queryClient.setQueryData<GameDesignSystemDetail>(queryKeys.gameDesignSystem(system.id), (current) => current ? { ...current, ...system } : current);
      void queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() });
      setEditingMetadata(false);
      setFeedback({ tone: 'success', text: 'System details saved.' });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to save system details.' }),
  });
  const versionMutation = useMutation({
    mutationFn: (input: CreateGameDesignSystemVersionRequest) => {
      if (!selectedVersion) throw new Error('Select a base version before creating a version.');
      if (!detail.current_version) throw new Error('Reload the current version before creating a version.');
      return createGameDesignSystemVersion(detail.id, input, versionIdempotencyKeyRef.current);
    },
    onSuccess: async (version) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystem(detail.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() }),
      ]);
      queryClient.setQueryData<GameDesignSystemDetail>(queryKeys.gameDesignSystem(detail.id), (current) => current ? {
        ...current,
        current_version_id: version.id,
        current_version: version,
        versions: [version, ...current.versions.filter((candidate) => candidate.id !== version.id)],
        body: version.rendered_markdown,
        genres: version.rules.genres,
        philosophies: version.rules.philosophies,
        suitable_for: version.rules.suitableFor,
      } : current);
      setSelectedVersionId(version.id);
      setEditingVersion(false);
      setView('overview');
      versionIdempotencyKeyRef.current = crypto.randomUUID();
      setFeedback({ tone: 'success', text: 'Version ' + version.version_number + ' created.' });
      window.setTimeout(() => globalThis.document.getElementById('gds-document-heading')?.focus(), 0);
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to create version.' }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteGameDesignSystem(detail.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() });
      props.onDeleted();
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to delete system.' }),
  });
  const busy = metadataMutation.isPending || versionMutation.isPending || deleteMutation.isPending;

  async function refreshLatestVersion(): Promise<GameDesignSystemVersion> {
    const latestDetail = await fetchGameDesignSystem(detail.id);
    queryClient.setQueryData(queryKeys.gameDesignSystem(detail.id), latestDetail);
    const latest = latestDetail.current_version;
    if (!latest) throw new Error('The current version could not be loaded.');
    versionIdempotencyKeyRef.current = crypto.randomUUID();
    return latest;
  }

  if (editingVersion && selectedVersion) {
    return <GameDesignSystemVersionEditor
      baseVersion={selectedVersion}
      currentVersionId={detail.current_version?.id ?? detail.current_version_id ?? selectedVersion.id}
      pending={versionMutation.isPending}
      onCancel={() => { setEditingVersion(false); window.setTimeout(() => versionActionRef.current?.focus(), 0); }}
      onCreate={(request) => versionMutation.mutateAsync(request)}
      onRefreshLatest={refreshLatestVersion}
    />;
  }

  return (
    <section className={styles.workspace} aria-label="System details">
      <header className={styles.workspaceHeader}>
        {editingMetadata ? (
          <div className={styles.metadataForm}>
            <div className={styles.field}><label htmlFor="gds-detail-title">System name</label><input id="gds-detail-title" className={styles.input} value={metadataDraft.title} onChange={(event) => setMetadataDraft((current) => ({ ...current, title: event.target.value }))} /></div>
            <div className={styles.field}><label htmlFor="gds-detail-status">Status</label><select id="gds-detail-status" className={styles.select} value={metadataDraft.status} onChange={(event) => setMetadataDraft((current) => ({ ...current, status: event.target.value as GameDesignSystemStatus }))}><option value="draft">Draft</option><option value="published">Published</option></select></div>
            <div className={styles.field}><label htmlFor="gds-detail-summary">System summary</label><textarea id="gds-detail-summary" className={styles.textarea} value={metadataDraft.summary} onChange={(event) => setMetadataDraft((current) => ({ ...current, summary: event.target.value }))} /></div>
          </div>
        ) : (
          <div className={styles.workspaceIdentity}>
            <div className={styles.identityLine}><h2>{detail.title}</h2><span className={styles.statusBadge}>{detail.status}</span></div>
            <p>{detail.summary || 'No summary'}</p>
            <div className={styles.tagRow}>{detail.genres.map((genre) => <span className={styles.badgeBlue} key={genre}>{genre}</span>)}{detail.philosophies.map((philosophy) => <span className={styles.badge} key={philosophy}>{philosophy}</span>)}</div>
          </div>
        )}
        <div className={styles.detailActions}>
          {owned && editingMetadata ? <button className={styles.primaryButton} type="button" aria-label="Save details" disabled={!metadataDraft.title.trim() || busy} onClick={() => metadataMutation.mutate()}><SaveOutlined /> Save details</button> : null}
          {owned ? <button className={styles.secondaryButton} type="button" aria-label={editingMetadata ? 'Cancel editing system info' : 'Edit system info'} disabled={busy} onClick={() => { if (editingMetadata) { if (!confirmDiscardDraft()) return; resetMetadataDraft(); setEditingMetadata(false); return; } setEditingMetadata(true); }}><EditOutlined /> {editingMetadata ? 'Cancel' : 'Edit system info'}</button> : null}
          {owned ? <button ref={versionActionRef} className={styles.primaryButton} type="button" aria-label="Start version iteration" disabled={busy || editingMetadata || !selectedVersion} onClick={() => { versionIdempotencyKeyRef.current = crypto.randomUUID(); setEditingVersion(true); }}><EditOutlined /> Start version iteration</button> : null}
          {owned ? <button className={styles.iconButtonDanger} type="button" aria-label="Delete system" title="Delete system" disabled={busy} onClick={() => { if (window.confirm('Delete this system?')) deleteMutation.mutate(); }}><DeleteOutlined /></button> : null}
        </div>
      </header>

      <div className={styles.workspaceControls}>
        <nav className={styles.viewTabs} aria-label="Game Design System views" role="tablist">
          {views.map((item) => <button type="button" role="tab" aria-selected={view === item.id} className={view === item.id ? styles.viewTabActive : styles.viewTab} key={item.id} onClick={() => changeView(item.id)}>{item.label}</button>)}
        </nav>
        <label className={styles.versionSelect}><span>Version</span><select className={styles.select} value={selectedVersion?.id ?? ''} onChange={(event) => changeVersion(event.target.value)}>{detail.versions.map((version) => <option key={version.id} value={version.id}>Version {version.version_number}{version.id === detail.current_version_id ? ' (Current)' : ''}</option>)}</select></label>
      </div>

      <div className={styles.versionIterationGuide} role="note">
        <div>
          <span className={styles.eyebrow}>Version workflow</span>
          <strong>Turn a design decision into a new immutable version</strong>
          <p>The current view is a read-only snapshot. Start an iteration to edit the game background, rules and tables, or Art Style, then review the exact changes before publishing.</p>
        </div>
        {owned ? <button className={styles.secondaryButton} type="button" aria-label="Start version iteration from workflow guide" onClick={() => { versionIdempotencyKeyRef.current = crypto.randomUUID(); setEditingVersion(true); }}><EditOutlined /> Start version iteration</button> : <span className={styles.inlineEmpty}>Read-only snapshot</span>}
      </div>

      {feedback ? <div className={feedback.tone === 'error' ? styles.error : styles.notice} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.text}</div> : null}
      {view === 'overview' ? <OverviewView key={selectedVersion?.id ?? 'no-version'} detail={detail} version={selectedVersion} canEdit={owned} onStartVersion={() => { versionIdempotencyKeyRef.current = crypto.randomUUID(); setEditingVersion(true); }} /> : null}
      {view === 'art-style' ? <ArtStyleView key={selectedVersion?.id ?? 'no-version'} version={selectedVersion} canEdit={owned} onStartVersion={() => { versionIdempotencyKeyRef.current = crypto.randomUUID(); setEditingVersion(true); }} /> : null}
      {view === 'rules' ? <RulesView key={selectedVersion?.id ?? 'no-version'} detail={detail} version={selectedVersion} canEdit={owned} onStartVersion={() => { versionIdempotencyKeyRef.current = crypto.randomUUID(); setEditingVersion(true); }} /> : null}
      {view === 'versions' ? <VersionsView detail={detail} selectedVersionId={selectedVersion?.id ?? ''} onSelect={changeVersion} canEdit={owned} onStartVersion={() => { versionIdempotencyKeyRef.current = crypto.randomUUID(); setEditingVersion(true); }} /> : null}
      {view === 'sources' ? <SourcesView version={selectedVersion} /> : null}
      {view === 'projects' ? <ProjectsView detail={detail} version={selectedVersion} projects={props.projects} loading={props.projectsLoading} error={props.projectsError} onRetry={props.onRetryProjects} onFeedback={setFeedback} /> : null}
      {view === 'versions' && selectedVersion ? <details className={styles.markdownDisclosure}><summary>View GAME_DESIGN_SYSTEM.md projection</summary><article className={styles.markdown}><ReactMarkdown>{selectedVersion.rendered_markdown}</ReactMarkdown></article></details> : null}
    </section>
  );
}
