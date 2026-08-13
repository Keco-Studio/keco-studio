'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DocumentRecentCard } from '@/components/admin/DocumentRecentCard';
import { LibraryCard } from '@/components/folders/LibraryCard';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';
import { useSupabase } from '@/lib/SupabaseContext';
import { getLibrariesAssetCounts, type Library } from '@/lib/services/libraryService';
import { filterStudioLibraries } from '@/lib/studioLibraryIsolation';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import { readRecentVisits, type RecentVisit } from '@/lib/recentVisits/storage';
import { queryKeys } from '@/lib/utils/queryKeys';
import tableIcon from '@/assets/images/table.svg';
import paperIcon from '@/assets/images/paper.svg';
import moreOptionsIcon from '@/assets/images/moreOptionsIcon.svg';
import styles from './RecentPage.module.css';

type RecentPageProps = {
  projectId: string;
};

type DocumentRow = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
};

type RecentItem =
  | { kind: 'table'; visit: RecentVisit; library: Library; assetCount: number }
  | { kind: 'document'; visit: RecentVisit; document: DocumentRow };

const VIEW_MODE_KEY = 'keco.recent.viewMode';

function readViewMode(): 'list' | 'grid' {
  if (typeof window === 'undefined') return 'list';
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    return raw === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function writeViewMode(mode: 'list' | 'grid') {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // ignore quota / private mode
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function RecentPage({ projectId }: RecentPageProps) {
  const router = useRouter();
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const userId = userProfile?.id ?? '';
  const roleQuery = useProjectRoleQuery(projectId, userProfile?.id);
  const [visits, setVisits] = useState<RecentVisit[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  useEffect(() => {
    setViewMode(readViewMode());
  }, []);

  const refresh = useCallback(() => {
    if (!userId) {
      setVisits([]);
      return;
    }
    setVisits(readRecentVisits(userId, projectId));
  }, [projectId, userId]);

  useEffect(() => {
    refresh();
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; projectId?: string }>).detail;
      if (detail?.userId && detail.userId !== userId) return;
      if (detail?.projectId && detail.projectId !== projectId) return;
      refresh();
    };
    window.addEventListener('keco-recent-visits-changed', onChange as EventListener);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('keco-recent-visits-changed', onChange as EventListener);
      window.removeEventListener('storage', refresh);
    };
  }, [projectId, refresh, userId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{
        mode?: 'list' | 'grid';
        projectId?: string;
        surface?: string;
      }>;
      const { mode, projectId: eventProjectId, surface } = custom.detail || {};
      if (surface !== 'recent') return;
      if (!mode || eventProjectId !== projectId) return;
      setViewMode(mode);
      writeViewMode(mode);
    };
    window.addEventListener('library-toolbar-view-mode-change', handler as EventListener);
    return () => {
      window.removeEventListener('library-toolbar-view-mode-change', handler as EventListener);
    };
  }, [projectId]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('library-page-view-mode-change', {
        detail: { mode: viewMode, projectId, surface: 'recent' },
      })
    );
  }, [projectId, viewMode]);

  const tableIds = useMemo(
    () => visits.filter((visit) => visit.kind === 'table').map((visit) => visit.id),
    [visits]
  );
  const documentIds = useMemo(
    () => visits.filter((visit) => visit.kind === 'document').map((visit) => visit.id),
    [visits]
  );

  const tablesQuery = useQuery({
    queryKey: ['recent-tables', projectId, tableIds.join(',')],
    queryFn: async () => {
      if (tableIds.length === 0) return [] as Library[];
      const { data, error } = await supabase
        .from('libraries')
        .select('*')
        .eq('project_id', projectId)
        .in('id', tableIds);
      if (error) throw error;
      return filterStudioLibraries((data as Library[]) ?? []);
    },
    enabled: tableIds.length > 0,
    staleTime: 30_000,
  });

  const documentsQuery = useQuery({
    queryKey: [...queryKeys.documents(projectId), 'recent', documentIds.join(',')],
    queryFn: async () => {
      if (documentIds.length === 0) return [] as DocumentRow[];
      const { data, error } = await supabase
        .from('documents')
        .select('id, name, description, updated_at')
        .eq('project_id', projectId)
        .in('id', documentIds);
      if (error) throw error;
      return (data as DocumentRow[]) ?? [];
    },
    enabled: documentIds.length > 0,
    staleTime: 30_000,
  });

  const countsQuery = useQuery({
    queryKey: ['recent-table-asset-counts', projectId, tableIds.join(',')],
    queryFn: () => getLibrariesAssetCounts(supabase, tableIds),
    enabled: tableIds.length > 0,
    staleTime: 30_000,
  });

  const items = useMemo(() => {
    const tablesById = new Map((tablesQuery.data ?? []).map((library) => [library.id, library]));
    const docsById = new Map((documentsQuery.data ?? []).map((document) => [document.id, document]));
    const counts = countsQuery.data ?? {};
    const next: RecentItem[] = [];

    for (const visit of visits) {
      if (visit.kind === 'table') {
        const library = tablesById.get(visit.id);
        if (!library) continue;
        next.push({
          kind: 'table',
          visit,
          library,
          assetCount: counts[library.id] || 0,
        });
        continue;
      }
      const document = docsById.get(visit.id);
      if (!document) continue;
      next.push({ kind: 'document', visit, document });
    }

    return next;
  }, [countsQuery.data, documentsQuery.data, tablesQuery.data, visits]);

  const isLoading =
    (tableIds.length > 0 && (tablesQuery.isLoading || countsQuery.isLoading)) ||
    (documentIds.length > 0 && documentsQuery.isLoading);

  const updaterLabel = userProfile?.full_name || userProfile?.username || userProfile?.email || 'You';
  const avatarLetter = updaterLabel.charAt(0).toUpperCase();
  const avatarColor = userProfile?.id
    ? getUserAvatarColor(userProfile.id)
    : '#7c3aed';

  return (
    <div className={styles.page} data-testid="recent-page">
      {visits.length === 0 ? (
        <div className={styles.empty}>
          No recent tables or documents yet. Open a table or document to see it here.
        </div>
      ) : isLoading ? (
        <div className={styles.empty}>Loading recent items...</div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          Recent tables or documents are no longer available in this project.
        </div>
      ) : viewMode === 'grid' ? (
        <div className={styles.grid}>
          {items.map((item) =>
            item.kind === 'table' ? (
              <LibraryCard
                key={`table:${item.library.id}`}
                library={item.library}
                projectId={projectId}
                assetCount={item.assetCount}
                userRole={roleQuery.data?.role ?? null}
                onClick={(libraryId) => router.push(`/${projectId}/${libraryId}`)}
              />
            ) : (
              <DocumentRecentCard
                key={`document:${item.document.id}`}
                documentId={item.document.id}
                name={item.document.name}
                description={item.document.description}
                onClick={() => router.push(`/${projectId}/doc/${item.document.id}`)}
              />
            )
          )}
        </div>
      ) : (
        <div className={styles.list}>
          <div className={styles.listHeader}>
            <span className={styles.colName}>NAME</span>
            <span className={styles.colUpdatedBy}>LAST UPDATED BY</span>
            <span className={styles.colItems}>ITEMS</span>
            <span className={styles.colUpdated}>LAST UPDATED</span>
            <span className={styles.colActions} />
          </div>
          {items.map((item) => {
            const isTable = item.kind === 'table';
            const name = isTable ? item.library.name : item.document.name;
            const updatedAt = isTable
              ? item.library.last_data_updated_at || item.library.updated_at
              : item.document.updated_at;
            const itemsLabel = isTable ? `${item.assetCount} assets` : 'Document';
            const href = isTable
              ? `/${projectId}/${item.library.id}`
              : `/${projectId}/doc/${item.document.id}`;

            return (
              <button
                key={`${item.kind}:${isTable ? item.library.id : item.document.id}`}
                type="button"
                className={styles.listRow}
                onClick={() => router.push(href)}
              >
                <span className={styles.colName}>
                  <Image
                    src={isTable ? tableIcon : paperIcon}
                    alt=""
                    width={20}
                    height={20}
                    className={styles.rowIcon}
                  />
                  <span className={styles.rowName}>{name}</span>
                </span>
                <span className={styles.colUpdatedBy}>
                  <span className={styles.avatar} style={{ backgroundColor: avatarColor }}>
                    {avatarLetter}
                  </span>
                  <span>{updaterLabel}</span>
                </span>
                <span className={styles.colItems}>{itemsLabel}</span>
                <span className={styles.colUpdated}>{formatDate(updatedAt)}</span>
                <span className={styles.colActions}>
                  <span className={styles.moreButton} aria-hidden>
                    <Image src={moreOptionsIcon} alt="" width={16} height={16} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
