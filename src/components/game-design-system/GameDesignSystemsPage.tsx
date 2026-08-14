'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { parseRuleSet, type GameDesignRule, type GameDesignRuleSet } from '@/lib/game-design-system/ruleSchema';
import type { GameDesignSystemDetail, GameDesignSystemStatus, GameDesignSystemVersion } from '@/lib/services/gameDesignSystemService';
import {
  applyProjectGameDesignSystem,
  copyGameDesignSystemDraft,
  createGameDesignSystemVersion,
  deleteGameDesignSystem,
  fetchGameDesignSystem,
  fetchGameDesignSystems,
  updateGameDesignSystemDraft,
} from '@/lib/services/gameDesignSystemClient';
import { queryKeys } from '@/lib/utils/queryKeys';
import { useAuth } from '@/lib/contexts/AuthContext';
import styles from './GameDesignSystemsPage.module.css';

type ProjectOption = { id: string; name: string };
type Scope = 'mine' | 'official';
type Feedback = { tone: 'success' | 'error'; text: string };

const ruleKindLabels: Record<GameDesignRule['kind'], string> = {
  principle: 'Design principles',
  constraint: 'Constraints',
  pattern: 'Design patterns',
  anti_pattern: 'Anti-patterns',
  check: 'Checks',
};

async function fetchProjects(): Promise<ProjectOption[]> {
  const response = await fetch('/api/projects', { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to load projects.');
  return (await response.json()) as ProjectOption[];
}

function versionHasConflicts(version: GameDesignSystemVersion | null): boolean {
  return Boolean(version && (version.conflicts?.length ?? 0) > 0);
}

export function GameDesignSystemsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userProfile } = useAuth();
  const viewerUserId = userProfile?.id ?? '';
  const [scope, setScope] = useState<Scope>('mine');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('systemId')
  ));
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState<{ title: string; summary: string; status: GameDesignSystemStatus }>({ title: '', summary: '', status: 'draft' });
  const [editingRules, setEditingRules] = useState(false);
  const [rulesDraft, setRulesDraft] = useState('');
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const systemsQuery = useQuery({ queryKey: queryKeys.gameDesignSystems(), queryFn: fetchGameDesignSystems });
  const projectsQuery = useQuery({ queryKey: queryKeys.projects(), queryFn: fetchProjects });
  const detailQuery = useQuery({
    queryKey: queryKeys.gameDesignSystem(selectedId ?? 'none'),
    queryFn: () => fetchGameDesignSystem(selectedId!),
    enabled: Boolean(selectedId),
  });

  const systems = systemsQuery.data ?? [];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return systems.filter((system) => {
      if (scope === 'mine' && (system.source !== 'user' || system.owner_id !== viewerUserId)) return false;
      if (scope === 'official' && system.source !== 'official') return false;
      if (!query) return true;
      return [system.title, system.summary, ...system.genres, ...system.philosophies]
        .filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [scope, search, systems, viewerUserId]);

  useEffect(() => {
    if (filtered.length === 0) {
      if (!selectedId || (!detailQuery.isLoading && detailQuery.data?.id !== selectedId)) setSelectedId(null);
      return;
    }
    const selectedMatchesScope = detailQuery.data?.id === selectedId
      && (scope === 'mine'
        ? detailQuery.data.source === 'user' && detailQuery.data.owner_id === viewerUserId
        : detailQuery.data.source === 'official');
    if (!selectedId || (!filtered.some((system) => system.id === selectedId) && !detailQuery.isLoading && !selectedMatchesScope)) {
      setSelectedId(filtered[0].id);
    }
  }, [detailQuery.data, detailQuery.isLoading, filtered, scope, selectedId, viewerUserId]);

  const detail = detailQuery.data ?? null;
  const selectedVersion = detail?.versions.find((version) => version.id === selectedVersionId)
    ?? detail?.current_version
    ?? detail?.versions[0]
    ?? null;

  useEffect(() => {
    if (!detail) return;
    const version = detail.current_version ?? detail.versions[0] ?? null;
    setSelectedVersionId(version?.id ?? '');
    setMetadataDraft({ title: detail.title, summary: detail.summary ?? '', status: detail.status });
    setRulesDraft(version ? JSON.stringify(version.rules, null, 2) : '');
    setEditingMetadata(false);
    setEditingRules(false);
    setRulesError(null);
  }, [detail?.id]);

  useEffect(() => {
    if (!selectedVersion || editingRules) return;
    setRulesDraft(JSON.stringify(selectedVersion.rules, null, 2));
    setRulesError(null);
  }, [editingRules, selectedVersion]);

  const metadataMutation = useMutation({
    mutationFn: () => updateGameDesignSystemDraft(detail!.id, {
      title: metadataDraft.title.trim(),
      summary: metadataDraft.summary.trim() || null,
      status: metadataDraft.status,
    }),
    onSuccess: (system) => {
      queryClient.setQueryData<GameDesignSystemDetail>(queryKeys.gameDesignSystem(system.id), (current) => current ? { ...current, ...system } : current);
      void queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() });
      setEditingMetadata(false);
      setFeedback({ tone: 'success', text: 'System details saved.' });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to save system details.' }),
  });

  const versionMutation = useMutation({
    mutationFn: (rules: GameDesignRuleSet) => createGameDesignSystemVersion(detail!.id, rules, selectedVersion?.id),
    onSuccess: async (version) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystem(detail!.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() }),
      ]);
      setSelectedVersionId(version.id);
      setEditingRules(false);
      setFeedback({ tone: 'success', text: `Version ${version.version_number} created.` });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to create version.' }),
  });

  const copyMutation = useMutation({
    mutationFn: () => copyGameDesignSystemDraft(detail!.id),
    onSuccess: (system) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() });
      setScope('mine');
      setSelectedId(system.id);
      setFeedback({ tone: 'success', text: 'Copied to My Systems.' });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to copy system.' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteGameDesignSystem(detail!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() });
      setSelectedId(null);
      setFeedback({ tone: 'success', text: 'System deleted.' });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to delete system.' }),
  });

  const applyMutation = useMutation({
    mutationFn: () => applyProjectGameDesignSystem(projectId, detail!.id, selectedVersion!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectGameDesignSystem(projectId) });
      setFeedback({ tone: 'success', text: `Version ${selectedVersion!.version_number} applied to project.` });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to apply version.' }),
  });

  function saveRules() {
    setRulesError(null);
    try {
      const rules = parseRuleSet(JSON.parse(rulesDraft));
      versionMutation.mutate(rules);
    } catch (error) {
      setRulesError(error instanceof Error ? error.message : 'Invalid rules JSON.');
    }
  }

  const groupedRules = useMemo(() => {
    const groups = new Map<GameDesignRule['kind'], GameDesignRule[]>();
    for (const rule of selectedVersion?.rules.rules ?? []) groups.set(rule.kind, [...(groups.get(rule.kind) ?? []), rule]);
    return [...groups.entries()];
  }, [selectedVersion]);

  const isOwned = detail?.source === 'user' && detail.owner_id === viewerUserId;
  const canCopy = detail?.source === 'official' || isOwned;
  const parentVersion = selectedVersion?.parent_version_id
    ? detail?.versions.find((version) => version.id === selectedVersion.parent_version_id) ?? null
    : null;
  const isBusy = metadataMutation.isPending || versionMutation.isPending || copyMutation.isPending || deleteMutation.isPending || applyMutation.isPending;
  const cannotApply = !projectId || !selectedVersion || detail?.migration_status !== 'ready' || versionHasConflicts(selectedVersion) || isBusy;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><h1 className={styles.title}>Game Design System</h1><p className={styles.subtitle}>Use versioned rules to guide GDDs, system design, and Keco tables.</p></div>
        <button className={styles.primaryButton} type="button" onClick={() => router.push('/game-design-systems/create')}><PlusOutlined /> Create system</button>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.scopeTabs} role="tablist" aria-label="System source">
          <button type="button" role="tab" aria-selected={scope === 'mine'} className={`${styles.scopeTab} ${scope === 'mine' ? styles.scopeTabActive : ''}`} onClick={() => setScope('mine')}>My Systems <span className={styles.count}>{systems.filter((system) => system.source === 'user' && system.owner_id === viewerUserId).length}</span></button>
          <button type="button" role="tab" aria-selected={scope === 'official'} className={`${styles.scopeTab} ${scope === 'official' ? styles.scopeTabActive : ''}`} onClick={() => setScope('official')}>Official Presets <span className={styles.count}>{systems.filter((system) => system.source === 'official').length}</span></button>
        </div>
        <input className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search systems, genres, or philosophies" aria-label="Search Game Design System" />
      </div>

      {feedback ? <div className={feedback.tone === 'error' ? styles.error : styles.notice} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.text}</div> : null}

      {systemsQuery.isLoading ? (
        <div className={styles.split} aria-busy="true"><aside className={styles.list}>{Array.from({ length: 5 }).map((_, index) => <div className={styles.skeleton} key={index} />)}</aside><section className={styles.detail}><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></section></div>
      ) : systemsQuery.isError ? (
        <div className={styles.empty}><p>Failed to load systems.</p><button className={styles.secondaryButton} type="button" onClick={() => systemsQuery.refetch()}><ReloadOutlined /> Retry</button></div>
      ) : (
        <div className={styles.split}>
          <aside className={styles.list} aria-label="Game Design System list">
            <div className={styles.listLabel}>{scope === 'mine' ? 'My Systems' : 'Official Presets'}</div>
            {filtered.length === 0 ? <div className={styles.empty}>No systems match the current filters.</div> : filtered.map((system) => (
              <button type="button" key={system.id} className={`${styles.row} ${system.id === selectedId ? styles.rowActive : ''}`} onClick={() => setSelectedId(system.id)}>
                <div className={styles.rowTitle}>{system.title}</div><div className={styles.rowSummary}>{system.summary || 'No summary'}</div>
                <div className={styles.rowMeta}><span className={`${styles.badge} ${system.source === 'official' ? styles.badgeBlue : styles.badgeGreen}`}>{system.source === 'official' ? 'Official' : 'Personal'}</span>{system.genres.slice(0, 2).map((genre) => <span className={styles.badge} key={genre}>{genre}</span>)}</div>
              </button>
            ))}
          </aside>

          <section className={styles.detail} aria-label="System details">
            {!selectedId ? <div className={styles.empty}>Select a system to view details, or create your first system.</div> : detailQuery.isLoading ? <div aria-busy="true"><div className={styles.skeleton} /><div className={styles.skeleton} /></div> : detailQuery.isError ? <div className={styles.empty}><p>Failed to load system details.</p><button className={styles.secondaryButton} type="button" onClick={() => detailQuery.refetch()}><ReloadOutlined /> Retry</button></div> : !detail ? <div className={styles.empty}>The system does not exist or you do not have access.</div> : (
              <>
                <div className={styles.detailHeader}>
                  {editingMetadata ? <div className={styles.metadataForm}>
                    <div className={styles.field}><label htmlFor="gds-detail-title">System name</label><input id="gds-detail-title" className={styles.input} value={metadataDraft.title} onChange={(event) => setMetadataDraft((current) => ({ ...current, title: event.target.value }))} /></div>
                    <div className={styles.field}><label htmlFor="gds-detail-summary">System summary</label><textarea id="gds-detail-summary" className={styles.textarea} value={metadataDraft.summary} onChange={(event) => setMetadataDraft((current) => ({ ...current, summary: event.target.value }))} /></div>
                    <div className={styles.field}><label htmlFor="gds-detail-status">Status</label><select id="gds-detail-status" className={styles.select} value={metadataDraft.status} onChange={(event) => setMetadataDraft((current) => ({ ...current, status: event.target.value as GameDesignSystemStatus }))}><option value="draft">Draft</option><option value="published">Published</option></select></div>
                  </div> : <div><h2 className={styles.detailTitle}>{detail.title}</h2><p className={styles.detailSummary}>{detail.summary || 'No summary'}</p><div className={styles.tagRow}>{detail.genres.map((genre) => <span className={`${styles.badge} ${styles.badgeBlue}`} key={genre}>{genre}</span>)}{detail.philosophies.map((philosophy) => <span className={styles.badge} key={philosophy}>{philosophy}</span>)}</div></div>}
                  <div className={styles.detailActions}>
                    {isOwned && editingMetadata ? <button className={styles.primaryButton} type="button" disabled={!metadataDraft.title.trim() || isBusy} onClick={() => metadataMutation.mutate()}><SaveOutlined aria-hidden="true" /> Save details</button> : null}
                    {isOwned ? <button className={styles.secondaryButton} type="button" disabled={isBusy} onClick={() => setEditingMetadata((value) => !value)}><EditOutlined aria-hidden="true" /> {editingMetadata ? 'Cancel' : 'Edit details'}</button> : null}
                    {canCopy ? <button className={styles.secondaryButton} type="button" disabled={isBusy} onClick={() => copyMutation.mutate()}><CopyOutlined aria-hidden="true" /> Copy and edit</button> : null}
                    {isOwned ? <button className={`${styles.secondaryButton} ${styles.dangerButton}`} type="button" disabled={isBusy} onClick={() => { if (window.confirm('Delete this system?')) deleteMutation.mutate(); }}><DeleteOutlined aria-hidden="true" /> Delete</button> : null}
                  </div>
                </div>

                <div className={styles.versionBar}>
                  <div className={styles.field}><label htmlFor="gds-version">View version</label><select id="gds-version" className={styles.select} value={selectedVersion?.id ?? ''} onChange={(event) => { setSelectedVersionId(event.target.value); setEditingRules(false); }}>{detail.versions.map((version) => <option key={version.id} value={version.id}>Version {version.version_number}{version.id === detail.current_version_id ? ' (Current)' : ''}</option>)}</select></div>
                  {selectedVersion ? <div className={styles.diffSummary} aria-label="Version diff"><span>Added {selectedVersion.diff.added.length}</span><span>Removed {selectedVersion.diff.removed.length}</span><span>Changed {selectedVersion.diff.changed.length}</span><span className={selectedVersion.conflicts.length > 0 ? styles.conflictText : undefined}>Conflicts {selectedVersion.conflicts.length}</span></div> : null}
                </div>
                {selectedVersion ? <div className={styles.versionComparison}>
                  <strong>{parentVersion ? `Based on version ${parentVersion.version_number}` : selectedVersion.parent_version_id ? `Based on external version ${selectedVersion.parent_version_id.slice(0, 8)}` : 'Initial version'}</strong>
                  {selectedVersion.diff.added.length > 0 ? <span>Added: {selectedVersion.diff.added.join(', ')}</span> : null}
                  {selectedVersion.diff.removed.length > 0 ? <span>Removed: {selectedVersion.diff.removed.join(', ')}</span> : null}
                  {selectedVersion.diff.changed.length > 0 ? <span>Changed: {selectedVersion.diff.changed.join(', ')}</span> : null}
                  {selectedVersion.conflicts.map((conflict) => <span className={styles.conflictText} key={`${conflict.ruleId}:${conflict.reason}`}>{conflict.ruleId}: {conflict.reason}</span>)}
                </div> : null}

                <div className={styles.applyBar}>
                  <span>Apply current version to project</span>
                  <select className={styles.select} value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Select project"><option value="">Select project</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
                  <button className={styles.primaryButton} type="button" disabled={cannotApply} title={versionHasConflicts(selectedVersion) ? 'The current version has rule type conflicts and cannot be applied.' : undefined} onClick={() => applyMutation.mutate()}>Use version {selectedVersion?.version_number ?? ''}</button>
                  {projectsQuery.isError ? <button className={styles.secondaryButton} type="button" onClick={() => projectsQuery.refetch()}><ReloadOutlined /> Retry projects</button> : null}
                </div>

                {versionHasConflicts(selectedVersion) ? <div className={styles.error} role="alert">The current version has rule type conflicts. Resolve them and create a new version before applying it to a project.</div> : null}

                {selectedVersion ? <>
                  <div className={styles.sectionHeader}><div><h3>Structured rules</h3><p>{selectedVersion.rules.rules.length} rules grouped by type.</p></div>{isOwned ? <button className={styles.secondaryButton} type="button" disabled={isBusy} onClick={() => setEditingRules((value) => !value)}><EditOutlined aria-hidden="true" /> {editingRules ? 'Cancel rule editing' : 'Edit rules'}</button> : null}</div>
                  {editingRules ? <div className={styles.ruleEditor}><label htmlFor="gds-rules-json">Rules JSON</label><textarea id="gds-rules-json" className={styles.editor} value={rulesDraft} onChange={(event) => setRulesDraft(event.target.value)} />{rulesError ? <div className={styles.error} role="alert">{rulesError}</div> : null}<div className={styles.formActions}><span>Saving creates a new version without modifying version history.</span><button className={styles.primaryButton} type="button" disabled={versionMutation.isPending} onClick={saveRules}><SaveOutlined aria-hidden="true" /> Create version</button></div></div> : <div className={styles.ruleGroups}>{groupedRules.map(([kind, rules]) => <section className={styles.ruleGroup} key={kind}><h4>{ruleKindLabels[kind]}</h4>{rules.map((rule) => <article className={styles.ruleRow} key={rule.id}><div className={styles.ruleIdentity}><code>{rule.id}</code><span className={`${styles.badge} ${rule.severity === 'required' ? styles.badgeBlue : ''}`}>{rule.severity}</span></div><strong>{rule.title}</strong><p>{rule.statement}</p><small>Applies when: {rule.appliesWhen}</small></article>)}</section>)}</div>}

                  <div className={styles.summaryGrid}>
                    <div className={styles.summaryBlock}><h3>Suitable for</h3><p>{selectedVersion.rules.suitableFor}</p></div>
                    <div className={styles.summaryBlock}><h3>Keco tables</h3><p>{selectedVersion.rules.tableGuidance.length > 0 ? selectedVersion.rules.tableGuidance.map((item) => item.table).join(', ') : 'No recommended tables specified.'}</p></div>
                    <div className={styles.summaryBlock}><h3>Content hash</h3><p><code>{selectedVersion.content_hash.slice(0, 16)}</code></p></div>
                  </div>

                  <div className={styles.provenance}><h3>Source snapshots</h3>{selectedVersion.source_snapshots.length === 0 ? <p>This version has no project source snapshots.</p> : selectedVersion.source_snapshots.map((source) => <div className={styles.provenanceRow} key={`${source.kind}:${source.resourceId ?? source.contentHash}`}><span className={styles.badge}>{source.kind === 'table' ? 'Keco table' : source.kind === 'document' ? 'Document' : 'Compatibility source'}</span><span><strong>{source.label}</strong><small>{source.byteCount} bytes · SHA-256 {source.contentHash.slice(0, 12)}{source.truncated ? ' · Truncated' : ''}</small></span></div>)}</div>

                  <details className={styles.markdownDisclosure}><summary>View GAME_DESIGN_SYSTEM.md projection</summary><article className={styles.markdown}><ReactMarkdown>{selectedVersion.rendered_markdown}</ReactMarkdown></article></details>
                </> : <div className={styles.empty}>This system has no available versions.</div>}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
