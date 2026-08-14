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
  principle: '设计原则',
  constraint: '硬约束',
  pattern: '设计模式',
  anti_pattern: '反模式',
  check: '检查项',
};

async function fetchProjects(): Promise<ProjectOption[]> {
  const response = await fetch('/api/projects', { cache: 'no-store' });
  if (!response.ok) throw new Error('项目列表加载失败。');
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
      setFeedback({ tone: 'success', text: '体系信息已保存。' });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : '信息保存失败。' }),
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
      setFeedback({ tone: 'success', text: `版本 ${version.version_number} 已创建。` });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : '版本创建失败。' }),
  });

  const copyMutation = useMutation({
    mutationFn: () => copyGameDesignSystemDraft(detail!.id),
    onSuccess: (system) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() });
      setScope('mine');
      setSelectedId(system.id);
      setFeedback({ tone: 'success', text: '已复制为个人体系。' });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : '复制失败。' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteGameDesignSystem(detail!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() });
      setSelectedId(null);
      setFeedback({ tone: 'success', text: '体系已删除。' });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : '删除失败。' }),
  });

  const applyMutation = useMutation({
    mutationFn: () => applyProjectGameDesignSystem(projectId, detail!.id, selectedVersion!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectGameDesignSystem(projectId) });
      setFeedback({ tone: 'success', text: `已将版本 ${selectedVersion!.version_number} 应用到项目。` });
    },
    onError: (error) => setFeedback({ tone: 'error', text: error instanceof Error ? error.message : '应用失败。' }),
  });

  function saveRules() {
    setRulesError(null);
    try {
      const rules = parseRuleSet(JSON.parse(rulesDraft));
      versionMutation.mutate(rules);
    } catch (error) {
      setRulesError(error instanceof Error ? error.message : '规则 JSON 无效。');
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
        <div><h1 className={styles.title}>Game Design System</h1><p className={styles.subtitle}>用版本化规则约束 GDD、系统设计与 Keco 表格。</p></div>
        <button className={styles.primaryButton} type="button" onClick={() => router.push('/game-design-systems/create')}><PlusOutlined /> 创建体系</button>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.scopeTabs} role="tablist" aria-label="体系来源">
          <button type="button" role="tab" aria-selected={scope === 'mine'} className={`${styles.scopeTab} ${scope === 'mine' ? styles.scopeTabActive : ''}`} onClick={() => setScope('mine')}>我的体系 <span className={styles.count}>{systems.filter((system) => system.source === 'user' && system.owner_id === viewerUserId).length}</span></button>
          <button type="button" role="tab" aria-selected={scope === 'official'} className={`${styles.scopeTab} ${scope === 'official' ? styles.scopeTabActive : ''}`} onClick={() => setScope('official')}>官方预设 <span className={styles.count}>{systems.filter((system) => system.source === 'official').length}</span></button>
        </div>
        <input className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索体系、类型或理念" aria-label="搜索 Game Design System" />
      </div>

      {feedback ? <div className={feedback.tone === 'error' ? styles.error : styles.notice} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.text}</div> : null}

      {systemsQuery.isLoading ? (
        <div className={styles.split} aria-busy="true"><aside className={styles.list}>{Array.from({ length: 5 }).map((_, index) => <div className={styles.skeleton} key={index} />)}</aside><section className={styles.detail}><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></section></div>
      ) : systemsQuery.isError ? (
        <div className={styles.empty}><p>体系加载失败。</p><button className={styles.secondaryButton} type="button" onClick={() => systemsQuery.refetch()}><ReloadOutlined /> 重试</button></div>
      ) : (
        <div className={styles.split}>
          <aside className={styles.list} aria-label="Game Design System 列表">
            <div className={styles.listLabel}>{scope === 'mine' ? '我的体系' : '官方预设'}</div>
            {filtered.length === 0 ? <div className={styles.empty}>当前没有匹配的体系。</div> : filtered.map((system) => (
              <button type="button" key={system.id} className={`${styles.row} ${system.id === selectedId ? styles.rowActive : ''}`} onClick={() => setSelectedId(system.id)}>
                <div className={styles.rowTitle}>{system.title}</div><div className={styles.rowSummary}>{system.summary || '暂无简介'}</div>
                <div className={styles.rowMeta}><span className={`${styles.badge} ${system.source === 'official' ? styles.badgeBlue : styles.badgeGreen}`}>{system.source === 'official' ? '官方' : '个人'}</span>{system.genres.slice(0, 2).map((genre) => <span className={styles.badge} key={genre}>{genre}</span>)}</div>
              </button>
            ))}
          </aside>

          <section className={styles.detail} aria-label="体系详情">
            {!selectedId ? <div className={styles.empty}>选择一个体系查看详情，或创建你的第一套体系。</div> : detailQuery.isLoading ? <div aria-busy="true"><div className={styles.skeleton} /><div className={styles.skeleton} /></div> : detailQuery.isError ? <div className={styles.empty}><p>体系详情加载失败。</p><button className={styles.secondaryButton} type="button" onClick={() => detailQuery.refetch()}><ReloadOutlined /> 重试</button></div> : !detail ? <div className={styles.empty}>体系不存在或没有访问权限。</div> : (
              <>
                <div className={styles.detailHeader}>
                  {editingMetadata ? <div className={styles.metadataForm}>
                    <div className={styles.field}><label htmlFor="gds-detail-title">体系名称</label><input id="gds-detail-title" className={styles.input} value={metadataDraft.title} onChange={(event) => setMetadataDraft((current) => ({ ...current, title: event.target.value }))} /></div>
                    <div className={styles.field}><label htmlFor="gds-detail-summary">体系简介</label><textarea id="gds-detail-summary" className={styles.textarea} value={metadataDraft.summary} onChange={(event) => setMetadataDraft((current) => ({ ...current, summary: event.target.value }))} /></div>
                    <div className={styles.field}><label htmlFor="gds-detail-status">状态</label><select id="gds-detail-status" className={styles.select} value={metadataDraft.status} onChange={(event) => setMetadataDraft((current) => ({ ...current, status: event.target.value as GameDesignSystemStatus }))}><option value="draft">草稿</option><option value="published">已发布</option></select></div>
                  </div> : <div><h2 className={styles.detailTitle}>{detail.title}</h2><p className={styles.detailSummary}>{detail.summary || '暂无简介'}</p><div className={styles.tagRow}>{detail.genres.map((genre) => <span className={`${styles.badge} ${styles.badgeBlue}`} key={genre}>{genre}</span>)}{detail.philosophies.map((philosophy) => <span className={styles.badge} key={philosophy}>{philosophy}</span>)}</div></div>}
                  <div className={styles.detailActions}>
                    {isOwned && editingMetadata ? <button className={styles.primaryButton} type="button" disabled={!metadataDraft.title.trim() || isBusy} onClick={() => metadataMutation.mutate()}><SaveOutlined aria-hidden="true" /> 保存信息</button> : null}
                    {isOwned ? <button className={styles.secondaryButton} type="button" disabled={isBusy} onClick={() => setEditingMetadata((value) => !value)}><EditOutlined aria-hidden="true" /> {editingMetadata ? '取消' : '编辑信息'}</button> : null}
                    {canCopy ? <button className={styles.secondaryButton} type="button" disabled={isBusy} onClick={() => copyMutation.mutate()}><CopyOutlined aria-hidden="true" /> 复制并修改</button> : null}
                    {isOwned ? <button className={`${styles.secondaryButton} ${styles.dangerButton}`} type="button" disabled={isBusy} onClick={() => { if (window.confirm('确定删除这套体系吗？')) deleteMutation.mutate(); }}><DeleteOutlined aria-hidden="true" /> 删除</button> : null}
                  </div>
                </div>

                <div className={styles.versionBar}>
                  <div className={styles.field}><label htmlFor="gds-version">查看版本</label><select id="gds-version" className={styles.select} value={selectedVersion?.id ?? ''} onChange={(event) => { setSelectedVersionId(event.target.value); setEditingRules(false); }}>{detail.versions.map((version) => <option key={version.id} value={version.id}>版本 {version.version_number}{version.id === detail.current_version_id ? ' (当前)' : ''}</option>)}</select></div>
                  {selectedVersion ? <div className={styles.diffSummary} aria-label="版本差异"><span>新增 {selectedVersion.diff.added.length}</span><span>移除 {selectedVersion.diff.removed.length}</span><span>修改 {selectedVersion.diff.changed.length}</span><span className={selectedVersion.conflicts.length > 0 ? styles.conflictText : undefined}>冲突 {selectedVersion.conflicts.length}</span></div> : null}
                </div>
                {selectedVersion ? <div className={styles.versionComparison}>
                  <strong>{parentVersion ? `基于版本 ${parentVersion.version_number}` : selectedVersion.parent_version_id ? `基于外部版本 ${selectedVersion.parent_version_id.slice(0, 8)}` : '初始版本'}</strong>
                  {selectedVersion.diff.added.length > 0 ? <span>新增: {selectedVersion.diff.added.join(', ')}</span> : null}
                  {selectedVersion.diff.removed.length > 0 ? <span>移除: {selectedVersion.diff.removed.join(', ')}</span> : null}
                  {selectedVersion.diff.changed.length > 0 ? <span>修改: {selectedVersion.diff.changed.join(', ')}</span> : null}
                  {selectedVersion.conflicts.map((conflict) => <span className={styles.conflictText} key={`${conflict.ruleId}:${conflict.reason}`}>{conflict.ruleId}: {conflict.reason}</span>)}
                </div> : null}

                <div className={styles.applyBar}>
                  <span>应用当前版本到项目</span>
                  <select className={styles.select} value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="选择项目"><option value="">选择项目</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
                  <button className={styles.primaryButton} type="button" disabled={cannotApply} title={versionHasConflicts(selectedVersion) ? '当前版本包含规则类型冲突，不能应用。' : undefined} onClick={() => applyMutation.mutate()}>使用版本 {selectedVersion?.version_number ?? ''}</button>
                  {projectsQuery.isError ? <button className={styles.secondaryButton} type="button" onClick={() => projectsQuery.refetch()}><ReloadOutlined /> 重试项目列表</button> : null}
                </div>

                {versionHasConflicts(selectedVersion) ? <div className={styles.error} role="alert">当前版本存在规则类型冲突。解决冲突并创建新版本后才能应用到项目。</div> : null}

                {selectedVersion ? <>
                  <div className={styles.sectionHeader}><div><h3>结构化规则</h3><p>{selectedVersion.rules.rules.length} 条规则，按类型分组。</p></div>{isOwned ? <button className={styles.secondaryButton} type="button" disabled={isBusy} onClick={() => setEditingRules((value) => !value)}><EditOutlined aria-hidden="true" /> {editingRules ? '取消编辑规则' : '编辑规则'}</button> : null}</div>
                  {editingRules ? <div className={styles.ruleEditor}><label htmlFor="gds-rules-json">规则 JSON</label><textarea id="gds-rules-json" className={styles.editor} value={rulesDraft} onChange={(event) => setRulesDraft(event.target.value)} />{rulesError ? <div className={styles.error} role="alert">{rulesError}</div> : null}<div className={styles.formActions}><span>保存会创建新版本，历史版本不会被修改。</span><button className={styles.primaryButton} type="button" disabled={versionMutation.isPending} onClick={saveRules}><SaveOutlined aria-hidden="true" /> 创建新版本</button></div></div> : <div className={styles.ruleGroups}>{groupedRules.map(([kind, rules]) => <section className={styles.ruleGroup} key={kind}><h4>{ruleKindLabels[kind]}</h4>{rules.map((rule) => <article className={styles.ruleRow} key={rule.id}><div className={styles.ruleIdentity}><code>{rule.id}</code><span className={`${styles.badge} ${rule.severity === 'required' ? styles.badgeBlue : ''}`}>{rule.severity}</span></div><strong>{rule.title}</strong><p>{rule.statement}</p><small>适用条件：{rule.appliesWhen}</small></article>)}</section>)}</div>}

                  <div className={styles.summaryGrid}>
                    <div className={styles.summaryBlock}><h3>适用场景</h3><p>{selectedVersion.rules.suitableFor}</p></div>
                    <div className={styles.summaryBlock}><h3>Keco 表格</h3><p>{selectedVersion.rules.tableGuidance.length > 0 ? selectedVersion.rules.tableGuidance.map((item) => item.table).join('、') : '没有指定推荐表格。'}</p></div>
                    <div className={styles.summaryBlock}><h3>内容哈希</h3><p><code>{selectedVersion.content_hash.slice(0, 16)}</code></p></div>
                  </div>

                  <div className={styles.provenance}><h3>来源快照</h3>{selectedVersion.source_snapshots.length === 0 ? <p>此版本没有项目来源快照。</p> : selectedVersion.source_snapshots.map((source) => <div className={styles.provenanceRow} key={`${source.kind}:${source.resourceId ?? source.contentHash}`}><span className={styles.badge}>{source.kind === 'table' ? 'Keco 表格' : source.kind === 'document' ? '文档' : '兼容来源'}</span><span><strong>{source.label}</strong><small>{source.byteCount} bytes · SHA-256 {source.contentHash.slice(0, 12)}{source.truncated ? ' · 已截断' : ''}</small></span></div>)}</div>

                  <details className={styles.markdownDisclosure}><summary>查看 GAME_DESIGN_SYSTEM.md 投影</summary><article className={styles.markdown}><ReactMarkdown>{selectedVersion.rendered_markdown}</ReactMarkdown></article></details>
                </> : <div className={styles.empty}>这套体系还没有可用版本。</div>}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
