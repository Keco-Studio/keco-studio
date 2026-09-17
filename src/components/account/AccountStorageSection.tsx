'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ACCOUNT_STORAGE_PAGE_SIZE,
  ACCOUNT_STORAGE_CRITICAL_PERCENT,
  ACCOUNT_STORAGE_WARNING_PERCENT,
  type AccountStorageFile,
  type AccountStorageFilePage,
  type AccountStorageProject,
  type AccountStorageSort,
  type AccountStorageSummary,
  type StorageSourceKind,
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
  { value: 'created_desc', label: 'Uploaded: newest first' },
  { value: 'created_asc', label: 'Uploaded: oldest first' },
];

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSourceKind(value: unknown): value is StorageSourceKind {
  return value === 'project_asset'
    || value === 'library_media'
    || value === 'document_image'
    || value === 'map_reference'
    || value === 'map_asset'
    || value === 'character_asset'
    || value === 'legacy_unassigned';
}

function isProject(value: unknown): value is AccountStorageProject {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AccountStorageProject>;
  return isNonEmptyString(candidate.id)
    && isNonEmptyString(candidate.name)
    && isNonEmptyString(candidate.ownerName)
    && isNonNegativeSafeInteger(candidate.fileCount)
    && isNonNegativeSafeInteger(candidate.usedBytes)
    && typeof candidate.ownedByCurrentUser === 'boolean';
}

function isProjectList(value: unknown): value is AccountStorageProject[] {
  return Array.isArray(value) && value.every(isProject);
}

function isAccountStorageSummary(value: unknown): value is AccountStorageSummary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AccountStorageSummary>;
  const unassigned = candidate.unassigned;
  const hasValidUnassigned = unassigned === null || (
    !!unassigned
    && typeof unassigned === 'object'
    && isNonNegativeSafeInteger(unassigned.fileCount)
    && isNonNegativeSafeInteger(unassigned.usedBytes)
  );

  return isNonNegativeSafeInteger(candidate.quotaBytes)
    && isNonNegativeSafeInteger(candidate.usedBytes)
    && isNonNegativeSafeInteger(candidate.reservedBytes)
    && isNonNegativeSafeInteger(candidate.remainingBytes)
    && isProjectList(candidate.ownedProjects)
    && isProjectList(candidate.sharedProjects)
    && hasValidUnassigned;
}

function isFile(value: unknown): value is AccountStorageFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AccountStorageFile>;
  return isNonEmptyString(candidate.id)
    && isNonEmptyString(candidate.name)
    && isNonEmptyString(candidate.mimeType)
    && isNonNegativeSafeInteger(candidate.sizeBytes)
    && isSourceKind(candidate.sourceKind)
    && (candidate.sourceEntityId === null || typeof candidate.sourceEntityId === 'string')
    && isNonEmptyString(candidate.createdAt)
    && Number.isFinite(Date.parse(candidate.createdAt))
    && typeof candidate.sourceAvailable === 'boolean';
}

function isFilePage(value: unknown): value is AccountStorageFilePage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AccountStorageFilePage>;
  return Array.isArray(candidate.items)
    && candidate.items.every(isFile)
    && isNonNegativeSafeInteger(candidate.total)
    && isNonNegativeSafeInteger(candidate.limit)
    && candidate.limit > 0
    && isNonNegativeSafeInteger(candidate.offset);
}

async function fetchAccountStorage(): Promise<AccountStorageSummary> {
  const response = await fetch('/api/account/storage', { cache: 'no-store' });
  if (!response.ok) throw new AccountStorageRequestError();

  const body: unknown = await response.json();
  if (!isAccountStorageSummary(body)) throw new AccountStorageRequestError();
  return body;
}

async function fetchProjectFiles(
  projectId: string,
  query: string,
  sort: AccountStorageSort,
  offset: number,
): Promise<AccountStorageFilePage> {
  const params = new URLSearchParams({
    query,
    sort,
    limit: String(ACCOUNT_STORAGE_PAGE_SIZE),
    offset: String(offset),
  });
  const response = await fetch(`/api/account/storage/projects/${projectId}/files?${params}`, { cache: 'no-store' });
  if (!response.ok) throw new AccountStorageRequestError();

  const body: unknown = await response.json();
  if (!isFilePage(body)) throw new AccountStorageRequestError();
  return body;
}

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  const digits = value >= 1000 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0$/, '')} ${units[unit]}`;
}

function formatFileCount(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

function formatUploadedAt(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function sourceLabel(kind: StorageSourceKind): string {
  switch (kind) {
    case 'project_asset': return 'Assets';
    case 'library_media': return 'Library';
    case 'document_image': return 'Document';
    case 'map_reference': return 'Map reference';
    case 'map_asset': return 'Assets';
    case 'character_asset': return 'Assets';
    case 'legacy_unassigned': return 'Unassigned legacy file';
  }
}

function sourceDestination(file: AccountStorageFile, projectId: string): string | null {
  if (!file.sourceAvailable) return null;

  switch (file.sourceKind) {
    case 'project_asset':
    case 'map_asset':
    case 'character_asset':
      return `/${projectId}/admin/assets`;
    case 'map_reference':
      return `/create-map?projectId=${encodeURIComponent(projectId)}`;
    case 'document_image':
      return file.sourceEntityId ? `/${projectId}/doc/${file.sourceEntityId}` : `/${projectId}`;
    case 'library_media':
      return `/${projectId}`;
    case 'legacy_unassigned':
      return null;
  }
}

function storagePercentage(summary: AccountStorageSummary): number {
  if (summary.quotaBytes === 0) return 0;
  return Math.min(100, Math.max(0, Math.round(summary.usedBytes * 100 / summary.quotaBytes)));
}

function usageWarning(percent: number): string | null {
  if (percent >= 100) {
    return 'Storage is full. New uploads are blocked until space is released or your allowance is increased.';
  }
  if (percent >= ACCOUNT_STORAGE_CRITICAL_PERCENT) {
    return 'Storage is 95% full. Free space soon to avoid blocked uploads.';
  }
  if (percent >= ACCOUNT_STORAGE_WARNING_PERCENT) {
    return 'Storage is 80% full. Consider freeing space before your projects reach their allowance.';
  }
  return null;
}

function ProjectButton({ project, selected, onSelect }: {
  project: AccountStorageProject;
  selected: boolean;
  onSelect: (project: AccountStorageProject) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.projectButton} ${selected ? styles.selectedProject : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(project)}
    >
      <span className={styles.projectName}>{project.name}</span>
      <span className={styles.projectMeta}>{formatFileCount(project.fileCount)} · {formatStorageBytes(project.usedBytes)}</span>
      {!project.ownedByCurrentUser ? <span className={styles.owner}>Owned by {project.ownerName}</span> : null}
    </button>
  );
}

export function AccountStorageSection() {
  const router = useRouter();
  const [selectedProject, setSelectedProject] = useState<AccountStorageProject | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<AccountStorageSort>('size_desc');
  const [offset, setOffset] = useState(0);
  const summaryQuery = useQuery({
    queryKey: ['account-storage'],
    queryFn: fetchAccountStorage,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const filesQuery = useQuery({
    queryKey: ['account-storage-files', selectedProject?.id, debouncedSearch, sort, offset],
    queryFn: () => fetchProjectFiles(selectedProject!.id, debouncedSearch, sort, offset),
    enabled: Boolean(selectedProject && selectedProject.fileCount > 0),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const firstLoadFailed = Boolean(summaryQuery.error && !summaryQuery.data);
  const refreshFailed = Boolean(summaryQuery.error && summaryQuery.data);
  const percent = summaryQuery.data ? storagePercentage(summaryQuery.data) : 0;
  const warning = summaryQuery.data ? usageWarning(percent) : null;
  const filePage = filesQuery.data;

  function selectProject(project: AccountStorageProject) {
    setSelectedProject(project);
    setSearch('');
    setDebouncedSearch('');
    setSort('size_desc');
    setOffset(0);
  }

  return (
    <section className={styles.section} aria-labelledby="account-storage-heading">
      <div className={styles.sectionHeading}>
        <span className={styles.icon} aria-hidden="true">▣</span>
        <div>
          <h2 id="account-storage-heading">Storage</h2>
          <p>Physical files stored by your projects.</p>
        </div>
      </div>

      {firstLoadFailed ? (
        <div className={styles.errorState} role="alert">
          <div>
            <strong>Storage data could not be loaded</strong>
            <span>The account service is temporarily unavailable.</span>
          </div>
          <button type="button" onClick={() => void summaryQuery.refetch()}>Retry</button>
        </div>
      ) : (
        <>
          <div className={styles.summary} data-testid="account-storage-summary" aria-busy={summaryQuery.isLoading}>
            <dl className={styles.ledger}>
              <div className={styles.ledgerItem}>
                <dt>Used</dt>
                <dd data-testid={summaryQuery.data ? 'account-storage-used' : undefined}>
                  {summaryQuery.data ? formatStorageBytes(summaryQuery.data.usedBytes) : <span className={styles.placeholder} data-testid="account-storage-value-placeholder" />}
                </dd>
              </div>
              <div className={styles.ledgerItem}>
                <dt>Allowance</dt>
                <dd>
                  {summaryQuery.data ? formatStorageBytes(summaryQuery.data.quotaBytes) : <span className={styles.placeholder} data-testid="account-storage-value-placeholder" />}
                </dd>
              </div>
              <div className={`${styles.ledgerItem} ${styles.remainingItem}`}>
                <dt>Remaining</dt>
                <dd>
                  {summaryQuery.data ? formatStorageBytes(summaryQuery.data.remainingBytes) : <span className={styles.placeholder} data-testid="account-storage-value-placeholder" />}
                </dd>
              </div>
            </dl>
            <div className={styles.progressDetails}>
              <div className={styles.progressTrack} role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <span className={styles.progressValue} style={{ width: `${percent}%` }} />
              </div>
              {summaryQuery.data ? <span>{percent}% used</span> : null}
            </div>
            {refreshFailed ? (
              <div className={styles.refreshError} role="alert">
                <span>Storage data could not be refreshed. Showing the last loaded values.</span>
                <button type="button" onClick={() => void summaryQuery.refetch()}>Retry</button>
              </div>
            ) : null}
            {warning ? <p className={percent >= 95 ? styles.criticalWarning : styles.warning} role="alert">{warning}</p> : null}
          </div>

          <div className={styles.explorer} data-testid="account-storage-explorer" data-stacks-on-mobile="true">
            <nav className={styles.projectPane} aria-label="Storage projects">
              <h3>My projects</h3>
              <div className={styles.projectList}>
                {summaryQuery.data?.ownedProjects.map((project) => (
                  <ProjectButton key={project.id} project={project} selected={selectedProject?.id === project.id} onSelect={selectProject} />
                ))}
                {summaryQuery.data?.unassigned ? (
                  <div className={styles.unassigned}>
                    <span>Unassigned legacy files</span>
                    <span>{formatFileCount(summaryQuery.data.unassigned.fileCount)} · {formatStorageBytes(summaryQuery.data.unassigned.usedBytes)}</span>
                  </div>
                ) : null}
              </div>
              <h3 className={styles.sharedHeading}>Shared with me</h3>
              <p className={styles.excluded}>Excluded from your allowance</p>
              <div className={styles.projectList}>
                {summaryQuery.data?.sharedProjects.map((project) => (
                  <ProjectButton key={project.id} project={project} selected={selectedProject?.id === project.id} onSelect={selectProject} />
                ))}
              </div>
            </nav>

            <div className={styles.filesPane}>
              <div className={styles.filesToolbar}>
                <label>
                  <span className={styles.visuallyHidden}>Search files</span>
                  <input
                    type="search"
                    role="searchbox"
                    aria-label="Search files"
                    placeholder="Search files"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    disabled={!selectedProject}
                  />
                </label>
                <label className={styles.sortLabel}>
                  <span>Sort files</span>
                  <select
                    aria-label="Sort files"
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value as AccountStorageSort);
                      setOffset(0);
                    }}
                    disabled={!selectedProject}
                  >
                    {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              {!selectedProject ? <p className={styles.emptyState}>Select a project to view its files.</p> : null}
              {selectedProject && selectedProject.fileCount === 0 ? <p className={styles.emptyState}>This project has no stored files.</p> : null}
              {selectedProject && selectedProject.fileCount > 0 && filesQuery.isLoading && !filePage ? <p className={styles.emptyState} role="status">Loading files</p> : null}
              {selectedProject && selectedProject.fileCount > 0 && filesQuery.error && !filePage ? <p className={styles.fileError} role="alert">Files could not be loaded for this project.</p> : null}
              {selectedProject && selectedProject.fileCount > 0 && filePage && filePage.items.length === 0 ? <p className={styles.emptyState}>This project has no stored files.</p> : null}
              {selectedProject && filePage && filePage.items.length > 0 ? (
                <>
                  <div className={styles.tableScroll}>
                    <table className={styles.fileTable}>
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Type</th>
                          <th scope="col">Size</th>
                          <th scope="col">Uploaded</th>
                          <th scope="col">Source</th>
                          <th scope="col"><span className={styles.visuallyHidden}>Action</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filePage.items.map((file) => {
                          const destination = sourceDestination(file, selectedProject.id);
                          return (
                            <tr key={file.id}>
                              <td className={styles.fileName}>{file.name}</td>
                              <td>{file.mimeType}</td>
                              <td>{formatStorageBytes(file.sizeBytes)}</td>
                              <td>{formatUploadedAt(file.createdAt)}</td>
                              <td>{file.sourceAvailable ? sourceLabel(file.sourceKind) : 'Source no longer exists'}</td>
                              <td>
                                <button
                                  type="button"
                                  className={styles.openButton}
                                  aria-label={`Open ${file.name} location`}
                                  disabled={!destination}
                                  onClick={() => {
                                    if (destination) router.push(destination);
                                  }}
                                >
                                  Open location
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className={styles.pagination}>
                    <span>{filePage.total} {filePage.total === 1 ? 'file' : 'files'}</span>
                    <div>
                      <button type="button" onClick={() => setOffset(Math.max(0, offset - filePage.limit))} disabled={offset === 0}>Previous page</button>
                      <button type="button" onClick={() => setOffset(offset + filePage.limit)} disabled={offset + filePage.limit >= filePage.total}>Next page</button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
