'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppstoreOutlined, CloseOutlined, FileTextOutlined, FolderOutlined, RightOutlined, TableOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  ACCOUNT_STORAGE_PAGE_SIZE,
  ACCOUNT_STORAGE_CRITICAL_PERCENT,
  ACCOUNT_STORAGE_WARNING_PERCENT,
  type AccountStorageEntity,
  type AccountStorageBreadcrumb,
  type AccountStorageEntityDetail,
  type AccountStorageEntityDetailItem,
  type AccountStorageEntityKind,
  type AccountStorageEntryKind,
  type AccountStorageEntityPage,
  type AccountStorageProject,
  type AccountStorageSort,
  type AccountStorageSummary,
} from '@/lib/types/accountStorage';
import styles from './AccountStorageSection.module.css';

class AccountStorageRequestError extends Error {
  constructor() {
    super('Unable to load account storage');
  }
}

const SORT_OPTIONS: ReadonlyArray<{ value: AccountStorageSort; label: string }> = [
  { value: 'size_desc', label: 'Size: largest first' },
  { value: 'size_asc', label: 'Size: smallest first' },
  { value: 'name_asc', label: 'Name: A to Z' },
  { value: 'name_desc', label: 'Name: Z to A' },
  { value: 'created_desc', label: 'Created: newest first' },
  { value: 'created_asc', label: 'Created: oldest first' },
];

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

type AccountStorageDetailEntity = Omit<AccountStorageEntity, 'kind'> & { kind: AccountStorageEntityKind };

function isEntityKind(value: unknown): value is AccountStorageEntityKind {
  return value === 'table' || value === 'document' || value === 'assets';
}

function isEntryKind(value: unknown): value is AccountStorageEntryKind {
  return value === 'folder' || isEntityKind(value);
}

function isDetailEntity(entity: AccountStorageEntity): entity is AccountStorageDetailEntity {
  return isEntityKind(entity.kind);
}

function isProject(value: unknown): value is AccountStorageProject {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AccountStorageProject>;
  return isNonEmptyString(candidate.id)
    && isNonEmptyString(candidate.name)
    && typeof candidate.ownerName === 'string'
    && isNonNegativeSafeInteger(candidate.fileCount)
    && isNonNegativeSafeInteger(candidate.usedBytes)
    && typeof candidate.ownedByCurrentUser === 'boolean';
}

function isAccountStorageSummary(value: unknown): value is AccountStorageSummary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AccountStorageSummary>;
  const unassigned = candidate.unassigned;
  return isNonNegativeSafeInteger(candidate.quotaBytes)
    && isNonNegativeSafeInteger(candidate.usedBytes)
    && isNonNegativeSafeInteger(candidate.physicalUsedBytes)
    && isNonNegativeSafeInteger(candidate.logicalUsedBytes)
    && isNonNegativeSafeInteger(candidate.reservedBytes)
    && isNonNegativeSafeInteger(candidate.remainingBytes)
    && isNonNegativeSafeInteger(candidate.overageBytes)
    && Array.isArray(candidate.ownedProjects)
    && candidate.ownedProjects.every(isProject)
    && Array.isArray(candidate.sharedProjects)
    && candidate.sharedProjects.every(isProject)
    && (unassigned === null || (
      !!unassigned
      && typeof unassigned === 'object'
      && isNonNegativeSafeInteger(unassigned.fileCount)
      && isNonNegativeSafeInteger(unassigned.usedBytes)
    ));
}

function isEntity(value: unknown): value is AccountStorageEntity {
  if (!value || typeof value !== 'object') return false;
  const entity = value as Partial<AccountStorageEntity>;
  return isNonEmptyString(entity.id)
    && isEntryKind(entity.kind)
    && typeof entity.name === 'string'
    && isNonEmptyString(entity.mimeType)
    && isNonNegativeSafeInteger(entity.logicalBytes)
    && isNonNegativeSafeInteger(entity.physicalBytes)
    && isNonNegativeSafeInteger(entity.sizeBytes)
    && entity.logicalBytes + entity.physicalBytes === entity.sizeBytes
    && (entity.parentFolderId === null || typeof entity.parentFolderId === 'string')
    && isNonEmptyString(entity.createdAt)
    && Number.isFinite(Date.parse(entity.createdAt))
    && typeof entity.sourceAvailable === 'boolean';
}

function isEntityPage(value: unknown): value is AccountStorageEntityPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<AccountStorageEntityPage>;
  return Array.isArray(page.items)
    && page.items.every(isEntity)
    && isNonNegativeSafeInteger(page.total)
    && isNonNegativeSafeInteger(page.limit)
    && page.limit > 0
    && isNonNegativeSafeInteger(page.offset)
    && Array.isArray(page.breadcrumb)
    && page.breadcrumb.every((part) => !!part
      && typeof part === 'object'
      && isNonEmptyString(part.id)
      && typeof part.name === 'string');
}

function isDetailItem(value: unknown): value is AccountStorageEntityDetailItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AccountStorageEntityDetailItem>;
  return isNonEmptyString(item.id)
    && typeof item.name === 'string'
    && isNonEmptyString(item.mimeType)
    && isNonNegativeSafeInteger(item.sizeBytes)
    && (item.itemKind === 'logical' || item.itemKind === 'media')
    && (item.groupId === null || typeof item.groupId === 'string')
    && (item.groupName === null || typeof item.groupName === 'string')
    && isNonEmptyString(item.createdAt)
    && Number.isFinite(Date.parse(item.createdAt));
}

function isEntityDetail(value: unknown): value is AccountStorageEntityDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Partial<AccountStorageEntityDetail>;
  return isNonEmptyString(detail.id)
    && isEntityKind(detail.kind)
    && typeof detail.name === 'string'
    && isNonNegativeSafeInteger(detail.logicalBytes)
    && isNonNegativeSafeInteger(detail.physicalBytes)
    && isNonNegativeSafeInteger(detail.sizeBytes)
    && detail.logicalBytes + detail.physicalBytes === detail.sizeBytes
    && typeof detail.sourceAvailable === 'boolean'
    && Array.isArray(detail.items)
    && detail.items.every(isDetailItem)
    && detail.items.reduce((total, item) => total + item.sizeBytes, 0) === detail.sizeBytes;
}

async function fetchAccountStorage(): Promise<AccountStorageSummary> {
  const response = await fetch('/api/account/storage', { cache: 'no-store' });
  if (!response.ok) throw new AccountStorageRequestError();
  const body: unknown = await response.json();
  if (!isAccountStorageSummary(body)) throw new AccountStorageRequestError();
  return body;
}

async function fetchProjectEntities(
  projectId: string,
  query: string,
  sort: AccountStorageSort,
  offset: number,
  parentFolderId: string | null,
): Promise<AccountStorageEntityPage> {
  const params = new URLSearchParams({ query, sort, limit: String(ACCOUNT_STORAGE_PAGE_SIZE), offset: String(offset) });
  if (parentFolderId) params.set('parentFolderId', parentFolderId);
  const response = await fetch(`/api/account/storage/projects/${projectId}/entities?${params}`, { cache: 'no-store' });
  if (!response.ok) throw new AccountStorageRequestError();
  const body: unknown = await response.json();
  if (!isEntityPage(body)) throw new AccountStorageRequestError();
  return body;
}

async function fetchEntityDetail(projectId: string, entity: AccountStorageDetailEntity): Promise<AccountStorageEntityDetail> {
  const response = await fetch(`/api/account/storage/projects/${projectId}/entities/${entity.kind}/${entity.id}`, { cache: 'no-store' });
  if (!response.ok) throw new AccountStorageRequestError();
  const body: unknown = await response.json();
  if (!isEntityDetail(body)) throw new AccountStorageRequestError();
  return body;
}

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  const digits = value >= 1000 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0$/, '')} ${units[unit]}`;
}

function formatEntityCount(count: number): string { return `${count} ${count === 1 ? 'item' : 'items'}`; }
function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}
function entityLabel(kind: AccountStorageEntryKind): string {
  if (kind === 'folder') return 'Folder';
  if (kind === 'table') return 'Table';
  if (kind === 'document') return 'Document';
  return 'Assets';
}
function entityIcon(kind: AccountStorageEntryKind) {
  if (kind === 'folder') return <FolderOutlined aria-hidden="true" />;
  if (kind === 'table') return <TableOutlined aria-hidden="true" />;
  if (kind === 'document') return <FileTextOutlined aria-hidden="true" />;
  return <AppstoreOutlined aria-hidden="true" />;
}
function entityDestination(entity: AccountStorageDetailEntity, projectId: string): string | null {
  if (!entity.sourceAvailable) return null;
  if (entity.kind === 'table') return `/${projectId}/${entity.id}`;
  if (entity.kind === 'document') return `/${projectId}/doc/${entity.id}`;
  return `/${projectId}/admin/assets`;
}
function storagePercentage(bytes: number, quotaBytes: number): number {
  return quotaBytes === 0 ? 0 : Math.min(100, Math.max(0, Math.round(bytes * 100 / quotaBytes)));
}
function usageWarning(physicalUsedBytes: number, quotaBytes: number): string | null {
  const rawPercent = quotaBytes === 0 ? 0 : physicalUsedBytes / quotaBytes * 100;
  if (rawPercent >= 100) return 'Storage is full. New uploads are blocked until space is released or your allowance is increased.';
  if (rawPercent >= ACCOUNT_STORAGE_CRITICAL_PERCENT) return 'Storage is 95% full. Free space soon to avoid blocked uploads.';
  if (rawPercent >= ACCOUNT_STORAGE_WARNING_PERCENT) return 'Storage is 80% full. Consider freeing space before your projects reach their allowance.';
  return null;
}

function ProjectButton({ project, selected, onSelect }: {
  project: AccountStorageProject;
  selected: boolean;
  onSelect: (project: AccountStorageProject) => void;
}) {
  return (
    <button type="button" className={`${styles.projectButton} ${selected ? styles.selectedProject : ''}`} aria-pressed={selected} onClick={() => onSelect(project)}>
      <span className={styles.projectName}>{project.name}</span>
      <span className={styles.projectMeta}>{formatEntityCount(project.fileCount)} · {formatStorageBytes(project.usedBytes)}</span>
      {!project.ownedByCurrentUser ? <span className={styles.owner}>Owned by {project.ownerName.trim() || 'Unknown owner'}</span> : null}
    </button>
  );
}

function DetailPane({ projectId, entity, onClose, onOpenSource }: {
  projectId: string;
  entity: AccountStorageDetailEntity;
  onClose: () => void;
  onOpenSource: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: ['account-storage-entity-detail', projectId, entity.kind, entity.id],
    queryFn: () => fetchEntityDetail(projectId, entity),
    retry: false,
    staleTime: 0,
  });
  const detail = detailQuery.data;
  const groups = useMemo(() => {
    const grouped = new Map<string, { name: string; items: AccountStorageEntityDetailItem[] }>();
    for (const item of detail?.items ?? []) {
      const key = item.groupId ?? item.itemKind;
      const group = grouped.get(key) ?? { name: item.groupName ?? (item.itemKind === 'logical' ? 'Content' : 'Media'), items: [] };
      group.items.push(item);
      grouped.set(key, group);
    }
    return [...grouped.values()];
  }, [detail]);

  return (
    <aside className={styles.detailPane} aria-label={`${entity.name || entityLabel(entity.kind)} storage details`}>
      <div className={styles.detailHeader}>
        <div className={styles.detailTitle}><span className={styles.entityIcon}>{entityIcon(entity.kind)}</span><div><span className={styles.detailKind}>{entityLabel(entity.kind)}</span><h4>{entity.name || `Untitled ${entityLabel(entity.kind).toLowerCase()}`}</h4></div></div>
        <button type="button" className={styles.iconButton} aria-label="Close storage details" title="Close" onClick={onClose}><CloseOutlined /></button>
      </div>
      <dl className={styles.detailTotals}>
        <div><dt>Total</dt><dd>{formatStorageBytes(entity.sizeBytes)}</dd></div>
        <div><dt>Content</dt><dd>{formatStorageBytes(entity.logicalBytes)}</dd></div>
        <div><dt>Media</dt><dd>{formatStorageBytes(entity.physicalBytes)}</dd></div>
      </dl>
      {detailQuery.isLoading ? <p className={styles.detailState} role="status">Loading details</p> : null}
      {detailQuery.error ? <div className={styles.detailError} role="alert"><span>Details could not be loaded.</span><button type="button" onClick={() => void detailQuery.refetch()}>Retry</button></div> : null}
      {detail && groups.length === 0 ? <p className={styles.detailState}>No detail items.</p> : null}
      {detail ? <div className={styles.detailGroups}>{groups.map((group) => <section key={`${group.name}-${group.items[0]?.id}`} className={styles.detailGroup}><div className={styles.detailGroupHeading}><h5>{group.name}</h5><span>{formatStorageBytes(group.items.reduce((total, item) => total + item.sizeBytes, 0))}</span></div><ul>{group.items.map((item) => <li key={item.id}><span>{item.name || 'Untitled media'}</span><span>{formatStorageBytes(item.sizeBytes)}</span></li>)}</ul></section>)}</div> : null}
      <button type="button" className={styles.sourceButton} disabled={!entity.sourceAvailable} onClick={onOpenSource}>Open {entityLabel(entity.kind)}</button>
    </aside>
  );
}

export function AccountStorageSection() {
  const router = useRouter();
  const [selectedProject, setSelectedProject] = useState<AccountStorageProject | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<AccountStorageDetailEntity | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [directoryPath, setDirectoryPath] = useState<AccountStorageBreadcrumb[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<AccountStorageSort>('size_desc');
  const [offset, setOffset] = useState(0);
  const summaryQuery = useQuery({ queryKey: ['account-storage'], queryFn: fetchAccountStorage, retry: false, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true });

  useEffect(() => {
    if (search === debouncedSearch) return;
    const timeout = window.setTimeout(() => { setDebouncedSearch(search); setOffset(0); setSelectedEntity(null); }, 250);
    return () => window.clearTimeout(timeout);
  }, [search, debouncedSearch]);

  const entitiesQuery = useQuery({
    queryKey: ['account-storage-entities', selectedProject?.id, currentFolderId, debouncedSearch, sort, offset],
    queryFn: () => fetchProjectEntities(selectedProject!.id, debouncedSearch, sort, offset, currentFolderId),
    enabled: Boolean(selectedProject && selectedProject.fileCount > 0),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const firstLoadFailed = Boolean(summaryQuery.error && !summaryQuery.data);
  const refreshFailed = Boolean(summaryQuery.error && summaryQuery.data);
  const percent = summaryQuery.data ? storagePercentage(summaryQuery.data.usedBytes, summaryQuery.data.quotaBytes) : 0;
  const physicalUsageIsCritical = summaryQuery.data ? summaryQuery.data.quotaBytes > 0 && summaryQuery.data.physicalUsedBytes / summaryQuery.data.quotaBytes * 100 >= ACCOUNT_STORAGE_CRITICAL_PERCENT : false;
  const warning = summaryQuery.data ? usageWarning(summaryQuery.data.physicalUsedBytes, summaryQuery.data.quotaBytes) : null;
  const entityPage = entitiesQuery.data;

  useEffect(() => {
    if (entityPage) setDirectoryPath(entityPage.breadcrumb);
  }, [entityPage]);

  function selectProject(project: AccountStorageProject) {
    setSelectedProject(project); setSelectedEntity(null); setCurrentFolderId(null); setDirectoryPath([]); setSearch(''); setDebouncedSearch(''); setSort('size_desc'); setOffset(0);
  }
  function navigateToFolder(folderId: string | null, path: AccountStorageBreadcrumb[]) {
    setCurrentFolderId(folderId); setDirectoryPath(path); setSelectedEntity(null); setSearch(''); setDebouncedSearch(''); setOffset(0);
  }
  function selectEntry(entity: AccountStorageEntity) {
    if (entity.kind === 'folder') {
      navigateToFolder(entity.id, [...directoryPath, { id: entity.id, name: entity.name }]);
      return;
    }
    if (isDetailEntity(entity)) setSelectedEntity(entity);
  }
  function openSelectedEntity() {
    if (!selectedProject || !selectedEntity) return;
    const destination = entityDestination(selectedEntity, selectedProject.id);
    if (destination) router.push(destination);
  }

  return (
    <section className={styles.section} aria-labelledby="account-storage-heading">
      <div className={styles.sectionHeading}><span className={styles.icon} aria-hidden="true"><AppstoreOutlined /></span><div><h2 id="account-storage-heading">Storage</h2><p>Content stored by your projects.</p></div></div>
      {firstLoadFailed ? <div className={styles.errorState} role="alert"><div><strong>Storage data could not be loaded</strong><span>The account service is temporarily unavailable.</span></div><button type="button" onClick={() => void summaryQuery.refetch()}>Retry</button></div> : (
        <>
          <div className={styles.summary} data-testid="account-storage-summary" aria-busy={summaryQuery.isLoading}>
            <dl className={styles.ledger}>
              <div className={styles.ledgerItem}><dt>Used</dt><dd data-testid={summaryQuery.data ? 'account-storage-used' : undefined}>{summaryQuery.data ? formatStorageBytes(summaryQuery.data.usedBytes) : <span className={styles.placeholder} data-testid="account-storage-value-placeholder" />}</dd></div>
              <div className={styles.ledgerItem}><dt>Allowance</dt><dd>{summaryQuery.data ? formatStorageBytes(summaryQuery.data.quotaBytes) : <span className={styles.placeholder} data-testid="account-storage-value-placeholder" />}</dd></div>
              <div className={`${styles.ledgerItem} ${styles.remainingItem}`}><dt>Remaining</dt><dd>{summaryQuery.data ? formatStorageBytes(summaryQuery.data.remainingBytes) : <span className={styles.placeholder} data-testid="account-storage-value-placeholder" />}</dd></div>
            </dl>
            <div className={styles.progressDetails}><div className={styles.progressTrack} role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span className={styles.progressValue} style={{ width: `${percent}%` }} /></div>{summaryQuery.data ? <span>{percent}% used</span> : null}</div>
            {summaryQuery.data ? <div className={styles.usageBreakdown} aria-label="Storage usage breakdown"><span>Media {formatStorageBytes(summaryQuery.data.physicalUsedBytes)}</span><span>Content {formatStorageBytes(summaryQuery.data.logicalUsedBytes)}</span></div> : null}
            {refreshFailed ? <div className={styles.refreshError} role="alert"><span>Storage data could not be refreshed. Showing the last loaded values.</span><button type="button" onClick={() => void summaryQuery.refetch()}>Retry</button></div> : null}
            {summaryQuery.data && summaryQuery.data.overageBytes > 0 ? <p className={styles.criticalWarning} role="alert">Stored content exceeds the allowance by {formatStorageBytes(summaryQuery.data.overageBytes)}.</p> : null}
            {warning ? <p className={physicalUsageIsCritical ? styles.criticalWarning : styles.warning} role="alert">{warning}</p> : null}
          </div>

          <div className={`${styles.explorer} ${selectedEntity ? styles.explorerWithDetail : ''}`} data-testid="account-storage-explorer" data-stacks-on-mobile="true">
            <nav className={styles.projectPane} aria-label="Storage projects">
              <h3>My projects</h3><div className={styles.projectList}>{summaryQuery.data?.ownedProjects.map((project) => <ProjectButton key={project.id} project={project} selected={selectedProject?.id === project.id} onSelect={selectProject} />)}{summaryQuery.data?.unassigned ? <div className={styles.unassigned}><span>Unassigned legacy files</span><span>{summaryQuery.data.unassigned.fileCount} files · {formatStorageBytes(summaryQuery.data.unassigned.usedBytes)}</span></div> : null}</div>
              <h3 className={styles.sharedHeading}>Shared with me</h3><p className={styles.excluded}>Excluded from your allowance</p><div className={styles.projectList}>{summaryQuery.data?.sharedProjects.map((project) => <ProjectButton key={project.id} project={project} selected={selectedProject?.id === project.id} onSelect={selectProject} />)}</div>
            </nav>

            <div className={styles.entitiesPane}>
              {selectedProject ? <nav className={styles.breadcrumbs} aria-label="Project storage path"><button type="button" aria-current={currentFolderId === null ? 'page' : undefined} onClick={() => navigateToFolder(null, [])}>{selectedProject.name}</button>{directoryPath.map((part, index) => <span key={part.id} className={styles.breadcrumbPart}><RightOutlined aria-hidden="true" /><button type="button" aria-current={index === directoryPath.length - 1 ? 'page' : undefined} onClick={() => navigateToFolder(part.id, directoryPath.slice(0, index + 1))}>{part.name || 'Untitled folder'}</button></span>)}</nav> : null}
              <div className={styles.entitiesToolbar}>
                <label><span className={styles.visuallyHidden}>Search folders, tables, documents, assets</span><input type="search" role="searchbox" aria-label="Search folders, tables, documents, assets" placeholder="Search folders, tables, documents, assets" value={search} onChange={(event) => setSearch(event.target.value)} disabled={!selectedProject} /></label>
                <label className={styles.sortLabel}><span>Sort items</span><select aria-label="Sort items" value={sort} onChange={(event) => { setSort(event.target.value as AccountStorageSort); setOffset(0); setSelectedEntity(null); }} disabled={!selectedProject}>{SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              </div>
              {!selectedProject ? <p className={styles.emptyState}>Select a project to view its stored content.</p> : null}
              {selectedProject && selectedProject.fileCount === 0 ? <p className={styles.emptyState}>This project has no stored content.</p> : null}
              {selectedProject && selectedProject.fileCount > 0 && entitiesQuery.isLoading && !entityPage ? <p className={styles.emptyState} role="status">Loading project items</p> : null}
              {selectedProject && selectedProject.fileCount > 0 && entitiesQuery.error && !entityPage ? <div className={styles.entityError} role="alert"><span>Project items could not be loaded.</span><button type="button" onClick={() => void entitiesQuery.refetch()}>Retry</button></div> : null}
              {selectedProject && entityPage && entityPage.items.length === 0 ? <p className={styles.emptyState}>No matching project items.</p> : null}
              {selectedProject && entityPage && entityPage.items.length > 0 ? <><div className={styles.entityList} role="list" aria-label="Project storage items">{entityPage.items.map((entity) => { const name = entity.name || `Untitled ${entityLabel(entity.kind).toLowerCase()}`; return <button key={`${entity.kind}-${entity.id}`} type="button" role="listitem" className={`${styles.entityRow} ${selectedEntity?.id === entity.id && selectedEntity.kind === entity.kind ? styles.selectedEntity : ''}`} onClick={() => selectEntry(entity)}><span className={styles.entityIcon}>{entityIcon(entity.kind)}</span><span className={styles.entityIdentity}><strong>{name}</strong><span>{entityLabel(entity.kind)} · {formatCreatedAt(entity.createdAt)}</span></span><span className={styles.entitySize}>{formatStorageBytes(entity.sizeBytes)}</span></button>; })}</div><div className={styles.pagination}><span>{entityPage.total} {entityPage.total === 1 ? 'item' : 'items'}</span><div><button type="button" onClick={() => { setOffset(Math.max(0, offset - entityPage.limit)); setSelectedEntity(null); }} disabled={offset === 0}>Previous page</button><button type="button" onClick={() => { setOffset(offset + entityPage.limit); setSelectedEntity(null); }} disabled={offset + entityPage.limit >= entityPage.total}>Next page</button></div></div></> : null}
            </div>
            {selectedProject && selectedEntity ? <DetailPane projectId={selectedProject.id} entity={selectedEntity} onClose={() => setSelectedEntity(null)} onOpenSource={openSelectedEntity} /> : null}
          </div>
        </>
      )}
    </section>
  );
}
