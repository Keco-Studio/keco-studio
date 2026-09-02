'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useSupabase } from '@/lib/SupabaseContext';
import Image from 'next/image';
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, Dropdown } from 'antd';
import { DownloadOutlined, HistoryOutlined } from '@ant-design/icons';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import styles from './TopBar.module.css';
import dialog from '@/components/shared/FormDialog.module.css';
import { ShareButton } from '@/components/shared/ShareButton';
import homeMorehorizontalIcon from '@/assets/images/homeMorehorizontalIcon.svg';
import homeQuestionIcon from '@/assets/images/homeQuestionIcon.svg';
import homeMessageIcon from '@/assets/images/loginMessageIcon.svg';
import homeDefaultUserIcon from '@/assets/images/homeDefaultUserIcon.svg';
import topbarPredefinePublishIcon from '@/assets/images/topbarPredefinePublishIcon.svg';
import assetViewIcon from '@/assets/images/assetViewIcon.svg';
import assetEditIcon from '@/assets/images/assetEditIcon.svg';
import topBarBreadCrumbIcon from '@/assets/images/topBarBreadCrumbIcon.svg';
import menuIcon from '@/assets/images/menuIcon36.svg';
import { LibraryToolbar } from '@/components/folders/LibraryToolbar';
import { LibraryHeader } from '@/components/libraries/LibraryHeader';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import { PresenceMembersStack } from '@/components/collaboration/PresenceMembersStack';
import { showSuccessToast, showErrorToast } from '@/lib/utils/toast';
import type { PresenceState, CollaboratorRole } from '@/lib/types/collaboration';
import searchIcon from "@/assets/images/searchIcon.svg";
import closeIcon from '@/assets/images/closeIcon32.svg';
import findCellContentIcon from '@/assets/images/findCellContentIcon.png';
import { useSidebarProjects } from './hooks/useSidebarProjects';
import { useSidebarFoldersLibraries } from './hooks/useSidebarFoldersLibraries';
import { normalizeSearchString } from '@/lib/utils/normalizeSearchString';
import { buildNormalizedIndexMap } from '@/lib/utils/cellValueReplace';
import { invalidateLibraryAssetsData } from '@/lib/queryInvalidation';
import {
  broadcastCellReplacementBatches,
  requestLibraryReconciliation,
  type CellReplacementUpdate,
} from '@/lib/realtime/cell-replacement-broadcast';
import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';
import { isScriptSystemPath } from '@/lib/script-system/isScriptSystemPath';
import { isCreateMapPath } from '@/lib/create-map/isCreateMapPath';
import { ScriptTopBarActions } from '@/components/script-system/ScriptTopBarActions';
import { readSimulationProjectPreference } from '@/lib/simulation/projectPreference';
import {
  DOCUMENT_PRESENCE_UPDATE_EVENT,
  type DocumentPresenceUpdateDetail,
} from '@/components/documents/documentPresenceEvents';

type TopBarProps = {
  breadcrumb?: string[];
  showCreateProjectBreadcrumb?: boolean;
};

type AssetMode = 'view' | 'edit';
const CELL_SEARCH_PAGE_SIZE = 10;
type DocumentExportItem = { key: string; label: string };

function CellContentIcon({
  size = 30,
  withBackground = true,
}: {
  size?: number;
  withBackground?: boolean;
}) {
  // Result rows: plugin icon on light-blue circle (Figma)
  if (withBackground) {
    const glyph = Math.round(size * 0.53); // ~16px inside 30px
    return (
      <span className={styles.cellSearchHitIconBadge} style={{ width: size, height: size }}>
        <Image
          src={findCellContentIcon}
          alt=""
          width={glyph}
          height={glyph}
          className={styles.cellSearchHitIconImg}
          aria-hidden
        />
      </span>
    );
  }

  // Tab: icon.24.plugin.png (Find or replace cell content)
  return (
    <Image
      src={findCellContentIcon}
      alt=""
      width={size}
      height={size}
      className={styles.cellSearchTabIconImg}
      aria-hidden
    />
  );
}

function CellHitLocationLabel({
  fieldLabel,
  libraryName,
}: {
  fieldLabel: string;
  libraryName?: string;
}) {
  const name = String(fieldLabel ?? '').trim();
  const lib = String(libraryName ?? '').trim();
  const title = name && lib ? `${name} (${lib})` : name || lib;
  return (
    <div className={styles.cellSearchHitLocation} title={title}>
      {name ? <span className={styles.cellSearchHitName}>{name}</span> : null}
      {name && lib ? ' ' : null}
      {lib ? <span className={styles.cellSearchHitLibraryParen}>({lib})</span> : null}
    </div>
  );
}

export function TopBar({ breadcrumb = [], showCreateProjectBreadcrumb: propShowCreateProjectBreadcrumb }: TopBarProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const onSimulationSystem = pathname?.startsWith('/simulation-system') ?? false;
  const onScriptSystem = isScriptSystemPath(pathname);
  const onCreateMap = isCreateMapPath(pathname);
  const {
    breadcrumbs,
    currentAssetId,
    currentDocumentId,
    currentProjectId,
    currentLibraryId,
    currentFolderId,
    isPredefinePage,
    isLibraryPage,
    showCreateProjectBreadcrumb: contextShowCreateProjectBreadcrumb,
  } = useNavigation();
  const showCreateProjectBreadcrumb = propShowCreateProjectBreadcrumb ?? contextShowCreateProjectBreadcrumb;
  const { userProfile, signOut } = useAuth();
  const userId = userProfile?.id;
  const supabase = useSupabase();
  const { data: projectRole } = useProjectRoleQuery(currentProjectId, userId);
  const userRole = projectRole?.role ?? null;
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [assetMode, setAssetMode] = useState<AssetMode>('edit');
  const [isCreatingNewAsset, setIsCreatingNewAsset] = useState(false);
  const [libraryViewMode, setLibraryViewMode] = useState<'list' | 'grid'>('grid');
  const [libraryVersionControlOpen, setLibraryVersionControlOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState<'all' | 'project' | 'folder' | 'library' | 'cell'>('all');
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const [topbarPresenceUsers, setTopbarPresenceUsers] = useState<PresenceState[]>([]);
  const [topbarDocumentPresenceUsers, setTopbarDocumentPresenceUsers] = useState<PresenceState[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [simulationProjectId, setSimulationProjectId] = useState<string | null>(null);
  const documentExportItems = useMemo<DocumentExportItem[]>(
    () => [
      { key: 'docx', label: 'Download DOCX' },
      { key: 'pdf', label: 'Download PDF' },
      { key: 'mdx', label: 'Download Markdown' },
    ],
    []
  );

  // Resolve display name: prefer username, then full_name, then email
  const displayName =
    userProfile?.username || userProfile?.full_name || userProfile?.email || 'Guest';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  // Get user avatar color (consistent color based on user ID)
  const userAvatarColor = useMemo(() => {
    return userProfile?.id ? getUserAvatarColor(userProfile.id) : '#999999';
  }, [userProfile?.id]);

  const { projects } = useSidebarProjects(userProfile?.id);
  useEffect(() => {
    if (onSimulationSystem) {
      setSimulationProjectId(readSimulationProjectPreference()?.projectId ?? null);

      const handler = (event: Event) => {
        const custom = event as CustomEvent<{ projectId?: string }>;
        setSimulationProjectId(custom.detail?.projectId ?? null);
      };

      window.addEventListener('simulation-project-changed', handler as EventListener);
      return () => {
        window.removeEventListener('simulation-project-changed', handler as EventListener);
      };
    }

    setSimulationProjectId(null);
    return undefined;
  }, [onSimulationSystem]);

  const searchProjectId = onSimulationSystem ? simulationProjectId : currentProjectId;
  const { folders, libraries } = useSidebarFoldersLibraries(searchProjectId, {
    excludeScriptLibraries: !onScriptSystem,
  });

  type SearchResultType = 'project' | 'folder' | 'library';

  type SearchResult = {
    type: SearchResultType;
    id: string;
    projectId: string;
    name: string;
    hierarchy?: string | null;
    updatedAt?: string | null;
  };

  const searchResults = useMemo<SearchResult[]>(() => {
    const q = searchQuery.trim();
    const normalizedQuery = normalizeSearchString(q);
    if (!normalizedQuery) return [];

    const projectResults: SearchResult[] = projects
      .filter((p) => normalizeSearchString(p.name).includes(normalizedQuery))
      .map((p) => ({
        type: 'project' as const,
        id: p.id,
        projectId: p.id,
        name: p.name,
        hierarchy: null,
        updatedAt: (p as any).updated_at ?? (p as any).created_at ?? null,
      }));

    const folderResults: SearchResult[] = folders
      .filter((f) => normalizeSearchString(f.name).includes(normalizedQuery))
      .map((f) => {
        const parentProject = projects.find((p) => p.id === f.project_id);
        const projectName = parentProject?.name ?? '';
        const path =
          projectName && f.name ? `${projectName} / ${f.name}` : projectName || f.name;
        return {
          type: 'folder' as const,
          id: f.id,
          projectId: f.project_id,
          name: f.name,
          hierarchy: path || null,
          updatedAt: (f as any).updated_at ?? (f as any).created_at ?? null,
        };
      });

    const libraryResults: SearchResult[] = libraries
      .filter((l) => normalizeSearchString(l.name).includes(normalizedQuery))
      .map((l) => {
        const parentProject = projects.find((p) => p.id === l.project_id);
        const parentFolder = l.folder_id
          ? folders.find((f) => f.id === l.folder_id)
          : null;
        const segments: string[] = [];
        if (parentProject?.name) segments.push(parentProject.name);
        if (parentFolder?.name) segments.push(parentFolder.name);
        const path = segments.join(' / ');
        return {
          type: 'library' as const,
          id: l.id,
          projectId: l.project_id,
          name: l.name,
          hierarchy: path || null,
          updatedAt: (l as any).updated_at ?? (l as any).created_at ?? null,
        };
      });

    // Limit the total number of results to prevent the dropdown from becoming excessively long.
    const all = [...projectResults, ...folderResults, ...libraryResults];
    return all.slice(0, 20);
  }, [searchQuery, projects, folders, libraries]);

  type CellSearchHit = {
    projectId: string;
    libraryId: string;
    libraryName: string;
    projectName: string;
    folderName: string;
    assetId: string;
    assetName: string;
    fieldId: string;
    fieldLabel: string;
    valueSnippet: string;
    assetUpdatedAt?: string | null;
  };

  const [cellSearchLoading, setCellSearchLoading] = useState(false);
  const [cellSearchHits, setCellSearchHits] = useState<CellSearchHit[]>([]);
  const [cellSearchPage, setCellSearchPage] = useState(1);
  /** Bumped on refocus so cell search re-fetches after table edits while blurred. */
  const [cellSearchRefreshKey, setCellSearchRefreshKey] = useState(0);
  const [cellReplaceText, setCellReplaceText] = useState('');
  const [cellReplaceModalOpen, setCellReplaceModalOpen] = useState(false);
  const [cellReplaceLoading, setCellReplaceLoading] = useState(false);
  const [cellReplacePendingMode, setCellReplacePendingMode] = useState<'single' | 'all'>('all');
  const [cellReplacePendingHit, setCellReplacePendingHit] = useState<CellSearchHit | null>(null);
  const [cellReplacePreview, setCellReplacePreview] = useState<{
    updated: number;
    skipped: number;
    previews: Array<{
      assetId: string;
      fieldId: string;
      fieldLabel: string;
      beforeDisplay: string;
      afterDisplay: string;
    }>;
    skips: Array<{ fieldLabel: string; reason: string }>;
  } | null>(null);

  const cellSearchTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(cellSearchHits.length / CELL_SEARCH_PAGE_SIZE));
  }, [cellSearchHits.length]);

  const pagedCellSearchHits = useMemo(() => {
    const start = (cellSearchPage - 1) * CELL_SEARCH_PAGE_SIZE;
    return cellSearchHits.slice(start, start + CELL_SEARCH_PAGE_SIZE);
  }, [cellSearchHits, cellSearchPage]);

  useEffect(() => {
    setCellSearchPage(1);
  }, [searchQuery, searchFilter]);

  useEffect(() => {
    if (cellSearchPage > cellSearchTotalPages) {
      setCellSearchPage(cellSearchTotalPages);
    }
  }, [cellSearchPage, cellSearchTotalPages]);

  useEffect(() => {
    if (searchFilter !== 'cell') {
      setCellSearchHits([]);
      setCellSearchLoading(false);
      return;
    }

    const q = searchQuery.trim();
    if (!q) {
      setCellSearchHits([]);
      setCellSearchLoading(false);
      return;
    }

    let aborted = false;
    const controller = new AbortController();
    setCellSearchLoading(true);

    const t = window.setTimeout(async () => {
      try {
        const sessionRes = await supabase.auth.getSession();
        const token = sessionRes.data?.session?.access_token;

        const res = await fetch(
          `/api/search/cell-values?q=${encodeURIComponent(q)}&limit=80&includeScript=${onScriptSystem}`,
          {
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          }
        );

        if (!res.ok) {
          if (aborted) return;
          setCellSearchHits([]);
          return;
        }

        const payload = await res.json();
        const results: any[] = Array.isArray(payload?.results) ? payload.results : [];
        if (aborted) return;
        const mapped = results.map((r) => ({
          projectId: String(r.project_id ?? r.projectId ?? ''),
          libraryId: String(r.library_id ?? r.libraryId ?? ''),
          libraryName: String(r.library_name ?? r.libraryName ?? ''),
          projectName: String(r.project_name ?? r.projectName ?? ''),
          folderName: String(r.folder_name ?? r.folderName ?? ''),
          assetId: String(r.asset_id ?? r.assetId ?? ''),
          assetName: String(r.asset_name ?? r.assetName ?? ''),
          fieldId: String(r.field_id ?? r.fieldId ?? ''),
          fieldLabel: String(r.field_label ?? r.fieldLabel ?? ''),
          valueSnippet: String(r.value_snippet ?? r.valueSnippet ?? ''),
          assetUpdatedAt: r.asset_updated_at ?? r.assetUpdatedAt ?? null,
        }));

        setCellSearchHits(mapped);

      } catch {
        if (aborted) return;
        setCellSearchHits([]);
      } finally {
        if (!aborted) setCellSearchLoading(false);
      }
    }, 250);

    return () => {
      aborted = true;
      window.clearTimeout(t);
      controller.abort();
    };
  }, [searchFilter, searchQuery, supabase, cellSearchRefreshKey, onScriptSystem]);

  // Projects, folders, and libraries active in the last 7 days.
  const recentResults = useMemo<SearchResult[]>(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = now - sevenDaysMs;

    const projectResults: SearchResult[] = projects
      .map((p) => {
        const updatedAt: string | null =
          (p as any).updated_at ?? (p as any).created_at ?? null;
        return {
          type: 'project' as const,
          id: p.id,
          projectId: p.id,
          name: p.name,
          hierarchy: null,
          updatedAt,
        };
      })
      .filter((item) => {
        if (!item.updatedAt) return false;
        const time = new Date(item.updatedAt).getTime();
        return !Number.isNaN(time) && time >= cutoff;
      });

    const folderResults: SearchResult[] = folders
      .map((f) => {
        const parentProject = projects.find((p) => p.id === f.project_id);
        const projectName = parentProject?.name ?? '';
        const path =
          projectName && f.name ? `${projectName} / ${f.name}` : projectName || f.name;
        const updatedAt: string | null =
          (f as any).updated_at ?? (f as any).created_at ?? null;
        return {
          type: 'folder' as const,
          id: f.id,
          projectId: f.project_id,
          name: f.name,
          hierarchy: path || null,
          updatedAt,
        };
      })
      .filter((item) => {
        if (!item.updatedAt) return false;
        const time = new Date(item.updatedAt).getTime();
        return !Number.isNaN(time) && time >= cutoff;
      });

    const libraryResults: SearchResult[] = libraries
      .map((l) => {
        const parentProject = projects.find((p) => p.id === l.project_id);
        const parentFolder = l.folder_id ? folders.find((f) => f.id === l.folder_id) : null;
        const segments: string[] = [];
        if (parentProject?.name) segments.push(parentProject.name);
        if (parentFolder?.name) segments.push(parentFolder.name);
        const path = segments.join(' / ');
        const updatedAt: string | null =
          (l as any).updated_at ?? (l as any).created_at ?? null;
        return {
          type: 'library' as const,
          id: l.id,
          projectId: l.project_id,
          name: l.name,
          hierarchy: path || null,
          updatedAt,
        };
      })
      .filter((item) => {
        if (!item.updatedAt) return false;
        const time = new Date(item.updatedAt).getTime();
        return !Number.isNaN(time) && time >= cutoff;
      });

    const all = [...projectResults, ...folderResults, ...libraryResults];
    // Sort by newest activity first and cap the result count.
    const sorted = all.sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });

    return sorted.slice(0, 20);
  }, [projects, folders, libraries]);

  const filteredSearchResults = useMemo(() => {
    const hasQuery = searchQuery.trim().length > 0;
    const baseResults = hasQuery ? searchResults : recentResults;

    const filtered =
      searchFilter === 'cell'
        ? []
        : searchFilter === 'all'
          ? baseResults
          : baseResults.filter((item) => item.type === searchFilter);

    // Sort by last modified time from newest to oldest
    return [...filtered]
      .sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 20);
  }, [searchResults, recentResults, searchFilter, searchQuery]);

  const formatUpdatedAtLabel = (updatedAt?: string | null) => {
    if (!updatedAt) return '';
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // For same-day activity, show the time, such as 11:41.
    const isSameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    if (isSameDay) {
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    // Within 24 hours: use "x hours ago"
    if (diffHours < 24) {
      return `${Math.max(diffHours, 1)} hours ago`;
    }

    // Within 7 days: use "x days ago"
    if (diffDays < 7) {
      return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    }

    // More than 7 days: use the date, e.g. "2025-03-11"
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const highlightMatch = (
    text: string | null | undefined,
    query: string,
    highlightClassName = styles.searchResultHighlight,
  ) => {
    if (!text) return null;
    const q = query.trim();
    if (!q) return text;

    const { normalized, indexMap } = buildNormalizedIndexMap(text);
    const normalizedQuery = normalizeSearchString(q);
    if (!normalizedQuery) return text;

    const index = normalized.indexOf(normalizedQuery);
    if (index === -1 || indexMap.length === 0) {
      return text;
    }
    const start = indexMap[index];
    const end = indexMap[index + normalizedQuery.length - 1] + 1;

    const before = text.slice(0, start);
    const match = text.slice(start, end);
    const after = text.slice(end);

    return (
      <>
        {before}
        <span className={highlightClassName}>{match}</span>
        {after}
      </>
    );
  };

  // Same normalized match as project/folder/library + highlightMatch (strip spaces/underscores).
  const highlightCellValue = (text: string | null | undefined, query: string) =>
    highlightMatch(text, query, styles.cellSearchHighlight);

  const getCellValuePreview = (text: string | null | undefined, maxLength = 88) => {
    if (text === null || text === undefined) return '';
    const trimmed = String(text).trim();
    if (trimmed.length <= maxLength) return trimmed;
    return `${trimmed.slice(0, maxLength)}...`;
  };

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  // Close search dropdown when clicking outside
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setIsSearchFocused(false);
        setIsSearchDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, []);

  const navigateToCellHit = (hit: CellSearchHit) => {
    const focusParams = new URLSearchParams({
      focusAssetId: hit.assetId,
      focusFieldId: hit.fieldId,
    });
    router.push(`/${hit.projectId}/${hit.libraryId}?${focusParams.toString()}`);
  };

  const clearCellSearchFocusState = useCallback(() => {
    if (typeof window === 'undefined') return;
    const nextParams = new URLSearchParams(window.location.search);
    nextParams.delete('focusAssetId');
    nextParams.delete('focusFieldId');
    nextParams.delete('cellSearchQ');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [pathname, router]);

  const runCellReplaceRequest = useCallback(
    async (params: {
      mode: 'single' | 'all';
      hit?: CellSearchHit;
      dryRun: boolean;
    }) => {
      const find = searchQuery.trim();
      if (!find) {
        throw new Error('Find text is required.');
      }

      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data?.session?.access_token;

      const res = await fetch('/api/search/cell-values/replace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          find,
          replace: cellReplaceText,
          mode: params.mode,
          dryRun: params.dryRun,
          ...(params.mode === 'single' && params.hit
            ? { assetId: params.hit.assetId, fieldId: params.hit.fieldId }
            : {}),
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        const err = new Error(payload?.error ?? 'Replace failed') as Error & {
          skips?: Array<{ fieldLabel: string; reason: string }>;
        };
        if (Array.isArray(payload?.skips)) {
          err.skips = payload.skips.map(
            (s: { fieldLabel?: string; reason?: string }) => ({
              fieldLabel: String(s.fieldLabel ?? 'Cell'),
              reason: String(s.reason ?? payload?.error ?? 'Replace failed'),
            })
          );
        }
        throw err;
      }
      const result = payload as {
        updated: number;
        skipped: number;
        affectedLibraryIds?: string[];
        cells?: CellReplacementUpdate[];
        previews: Array<{
          assetId: string;
          fieldId: string;
          fieldLabel: string;
          beforeDisplay: string;
          afterDisplay: string;
        }>;
        skips?: Array<{ fieldLabel: string; reason: string }>;
      };
      if (!params.dryRun && result.updated > 0) {
        const cells = result.cells ?? [];
        requestLibraryReconciliation(
          result.affectedLibraryIds ?? cells.map((cell) => cell.libraryId)
        );
        try {
          await broadcastCellReplacementBatches({ supabase, cells, accessToken: token });
        } catch (error) {
          console.warn('[TopBar] Realtime cell replacement broadcast failed:', error);
        }
      }
      return result;
    },
    [cellReplaceText, searchQuery, supabase]
  );

  const openCellReplaceConfirm = useCallback(
    async (mode: 'single' | 'all', hit?: CellSearchHit) => {
      const find = searchQuery.trim();
      if (!find) return;

      setCellReplacePendingMode(mode);
      setCellReplacePendingHit(hit ?? null);
      setCellReplaceLoading(true);
      setCellReplaceModalOpen(true);
      setCellReplacePreview(null);

      try {
        const preview = await runCellReplaceRequest({ mode, hit, dryRun: true });
        setCellReplacePreview({
          updated: preview.updated,
          skipped: preview.skipped,
          previews: preview.previews,
          skips: preview.skips ?? [],
        });
      } catch (error) {
        setCellReplacePreview({
          updated: 0,
          skipped: 1,
          previews: [],
          skips: [
            {
              fieldLabel: hit?.fieldLabel ?? 'Cells',
              reason: error instanceof Error ? error.message : 'Replace preview failed',
            },
          ],
        });
      } finally {
        setCellReplaceLoading(false);
      }
    },
    [runCellReplaceRequest, searchQuery]
  );

  const confirmCellReplace = useCallback(async () => {
    setCellReplaceLoading(true);
    try {
      const result = await runCellReplaceRequest({
        mode: cellReplacePendingMode,
        hit: cellReplacePendingHit ?? undefined,
        dryRun: false,
      });

      if (result.updated === 0) {
        const reason =
          result.skips?.[0]?.reason ??
          'No cells were saved. You may lack edit permission, or values changed since preview.';
        showErrorToast(reason);
        setCellReplaceModalOpen(false);
        setCellReplacePreview(null);
        return;
      }

      setCellReplaceModalOpen(false);
      setCellReplacePreview(null);

      if (result.updated > 0) {
        clearCellSearchFocusState();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('libraryCellSearchHighlightClear'));
        }

        const libraryIds = new Set<string>(
          (result.affectedLibraryIds ?? []).filter((id) => id.length > 0)
        );
        if (cellReplacePendingHit?.libraryId) {
          libraryIds.add(cellReplacePendingHit.libraryId);
        }
        if (libraryIds.size === 0 && currentLibraryId) {
          libraryIds.add(currentLibraryId);
        }
        await Promise.all(
          Array.from(libraryIds).map((libraryId) =>
            invalidateLibraryAssetsData(queryClient, {
              libraryId,
              includeSchema: true,
              refetchActiveAssets: true,
            })
          )
        );
        setCellSearchRefreshKey((key) => key + 1);

        const q = searchQuery.trim();
        const sessionRes = await supabase.auth.getSession();
        const token = sessionRes.data?.session?.access_token;
        const res = await fetch(`/api/search/cell-values?q=${encodeURIComponent(q)}&limit=80`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (res.ok) {
          const payload = await res.json();
          const results: any[] = Array.isArray(payload?.results) ? payload.results : [];
          const mapped = results.map((r) => ({
            projectId: String(r.project_id ?? r.projectId ?? ''),
            libraryId: String(r.library_id ?? r.libraryId ?? ''),
            libraryName: String(r.library_name ?? r.libraryName ?? ''),
            projectName: String(r.project_name ?? r.projectName ?? ''),
            folderName: String(r.folder_name ?? r.folderName ?? ''),
            assetId: String(r.asset_id ?? r.assetId ?? ''),
            assetName: String(r.asset_name ?? r.assetName ?? ''),
            fieldId: String(r.field_id ?? r.fieldId ?? ''),
            fieldLabel: String(r.field_label ?? r.fieldLabel ?? ''),
            valueSnippet: String(r.value_snippet ?? r.valueSnippet ?? ''),
            assetUpdatedAt: r.asset_updated_at ?? r.assetUpdatedAt ?? null,
          }));
          setCellSearchHits(mapped);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Replace failed';
      const apiSkips =
        error instanceof Error && 'skips' in error
          ? (error as Error & { skips?: Array<{ fieldLabel: string; reason: string }> }).skips
          : undefined;
      showErrorToast(apiSkips?.[0]?.reason ?? message);
      setCellReplaceModalOpen(false);
      setCellReplacePreview(null);
    } finally {
      setCellReplaceLoading(false);
    }
  }, [
    cellReplacePendingHit,
    cellReplacePendingMode,
    clearCellSearchFocusState,
    currentLibraryId,
    runCellReplaceRequest,
    searchQuery,
    supabase,
  ]);

  // Reset asset mode when navigating to a different asset
  useEffect(() => {
    setAssetMode('edit');
    setIsCreatingNewAsset(false);
  }, [currentAssetId]);

  // Listen to asset page mode updates (for create/view/edit detection)
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ mode?: string; isNewAsset?: boolean }>;
      if (custom.detail?.isNewAsset === true) {
        setIsCreatingNewAsset(true);
      } else {
        setIsCreatingNewAsset(false);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('asset-page-mode', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('asset-page-mode', handler as EventListener);
      }
    };
  }, []);

  // Prefer breadcrumbs from NavigationContext; fall back to the prop-based list
  const displayBreadcrumbs =
    breadcrumbs.length > 0 ? breadcrumbs : breadcrumb.map((label) => ({ label, path: '' }));

  const handleBreadcrumbClick = (path: string, index: number) => {
    // Navigate to the breadcrumb path when it is not the last item
    if (path && index < displayBreadcrumbs.length - 1) {
      router.push(path);
    }
  };

  const handleLogout = async () => {
    setShowUserMenu(false);
    await signOut();
    // Navigate to /projects after logout
    router.push('/projects');
  };

  const handleMcpNavigation = () => {
    setShowUserMenu(false);
    router.push('/mcp');
  };

  const isPredefine = isPredefinePage;
  const isAssetDetail = !!currentAssetId;
  const isDocumentDetail = !!currentDocumentId;
  const shareProjectName =
    projects.find((p) => p.id === currentProjectId)?.name?.trim() || 'Project';
  const onRecentPage =
    !!currentProjectId && (pathname ?? '').startsWith(`/${currentProjectId}/recent`);
  const onAdminPage =
    !!currentProjectId && (pathname ?? '').startsWith(`/${currentProjectId}/admin`);
  const isProjectRootPage =
    !!currentProjectId &&
    !currentFolderId &&
    !currentLibraryId &&
    !currentAssetId &&
    !isPredefine &&
    !onRecentPage &&
    !onAdminPage &&
    !isDocumentDetail;
  const isFolderPage =
    !!currentProjectId && !!currentFolderId && !currentLibraryId && !currentAssetId && !isPredefine;
  const isLibraryTopLevelPage =
    isLibraryPage && !!currentLibraryId && !currentAssetId && !isPredefine;

  // Sync view mode from page-level LibraryToolbar to TopBar
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{
        mode?: 'list' | 'grid';
        projectId?: string;
        folderId?: string | null;
        surface?: string;
      }>;

      const { mode, projectId, folderId, surface } = custom.detail || {};
      if (!mode) return;
      if (!currentProjectId || projectId !== currentProjectId) return;

      if (surface === 'recent') {
        if (!onRecentPage) return;
        setLibraryViewMode(mode);
        return;
      }

      const currentFolderOrNull = currentFolderId ?? null;
      const detailFolderOrNull = folderId ?? null;

      if (currentFolderOrNull !== detailFolderOrNull) return;

      setLibraryViewMode(mode);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('library-page-view-mode-change', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('library-page-view-mode-change', handler as EventListener);
      }
    };
  }, [currentProjectId, currentFolderId, onRecentPage]);

  // Sync version control open state from LibraryPage to TopBar
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{
        projectId?: string;
        libraryId?: string;
        isOpen?: boolean;
      }>;

      const { projectId, libraryId, isOpen } = custom.detail || {};
      if (projectId !== currentProjectId || libraryId !== currentLibraryId) return;
      if (typeof isOpen !== 'boolean') return;

      setLibraryVersionControlOpen(isOpen);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('library-version-control-state', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('library-version-control-state', handler as EventListener);
      }
    };
  }, [currentProjectId, currentLibraryId]);

  // Receive presence updates from LibraryPage (LibraryDataContext) so TopBar
  // can render LibraryHeader with real-time collaborators in the top row.
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{
        projectId?: string;
        libraryId?: string;
        presenceUsers?: PresenceState[];
      }>;

      const detail = custom.detail;
      if (!detail) return;
      if (detail.projectId !== currentProjectId || detail.libraryId !== currentLibraryId) return;

      setTopbarPresenceUsers(detail.presenceUsers || []);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('library-presence-update', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('library-presence-update', handler as EventListener);
      }
    };
  }, [currentProjectId, currentLibraryId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<DocumentPresenceUpdateDetail>).detail;
      if (!detail) return;
      if (detail.projectId !== currentProjectId || detail.documentId !== currentDocumentId) {
        return;
      }
      setTopbarDocumentPresenceUsers(detail.presenceUsers || []);
    };

    window.addEventListener(DOCUMENT_PRESENCE_UPDATE_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(DOCUMENT_PRESENCE_UPDATE_EVENT, handler as EventListener);
    };
  }, [currentProjectId, currentDocumentId]);

  useEffect(() => {
    setTopbarDocumentPresenceUsers([]);
  }, [currentDocumentId]);

  const handlePredefinePublish = () => {
    // Placeholder for future publish behavior
    // eslint-disable-next-line no-console
    console.log('Predefine publish clicked');
  };

  const changeAssetMode = (mode: AssetMode) => {
    setAssetMode(mode);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('asset-mode-change', {
          detail: { mode },
        })
      );
    }
  };

  const handleSidebarToggle = () => {
    // Dispatch event to toggle sidebar
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('sidebar-toggle'));
    }
  };

  const handleCreateAsset = () => {
    // Trigger asset save from the asset page
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asset-create-save'));
    }
  };

  const handleDocumentExport = (key: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('document-export-trigger', {
          detail: { key },
        })
      );
    }
  };

  const handleDocumentHistoryToggle = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('document-history-toggle'));
    }
  };

  const handleTopbarViewModeChange = (mode: 'list' | 'grid') => {
    setLibraryViewMode(mode);
    if (typeof window !== 'undefined' && currentProjectId) {
      window.dispatchEvent(
        new CustomEvent('library-toolbar-view-mode-change', {
          detail: {
            mode,
            projectId: currentProjectId,
            folderId: isFolderPage ? currentFolderId ?? null : null,
            surface: onRecentPage ? 'recent' : undefined,
          },
        })
      );
    }
  };

  const handleTopbarCreateFolder = () => {
    if (typeof window !== 'undefined' && currentProjectId) {
      window.dispatchEvent(
        new CustomEvent('library-toolbar-create-folder', {
          detail: {
            projectId: currentProjectId,
            folderId: isFolderPage ? currentFolderId ?? null : null,
          },
        })
      );
    }
  };

  const handleTopbarCreateLibrary = () => {
    if (typeof window !== 'undefined' && currentProjectId) {
      window.dispatchEvent(
        new CustomEvent('library-toolbar-create-library', {
          detail: {
            projectId: currentProjectId,
            folderId: isFolderPage ? currentFolderId ?? null : null,
          },
        })
      );
    }
  };

  const handleTopbarCreateDocument = () => {
    if (typeof window !== 'undefined' && currentProjectId) {
      window.dispatchEvent(
        new CustomEvent('library-toolbar-create-document', {
          detail: {
            projectId: currentProjectId,
            folderId: isFolderPage ? currentFolderId ?? null : null,
          },
        })
      );
    }
  };

  const handleTopbarImportTable = () => {
    if (typeof window !== 'undefined' && currentProjectId) {
      window.dispatchEvent(
        new CustomEvent('library-toolbar-import-table', {
          detail: {
            projectId: currentProjectId,
            folderId: isFolderPage ? currentFolderId ?? null : null,
          },
        })
      );
    }
  };

  const handleTopbarImportDocument = () => {
    if (typeof window !== 'undefined' && currentProjectId) {
      window.dispatchEvent(
        new CustomEvent('library-toolbar-import-document', {
          detail: {
            projectId: currentProjectId,
            folderId: isFolderPage ? currentFolderId ?? null : null,
          },
        })
      );
    }
  };

  const handleTopbarVersionControlToggle = () => {
    if (typeof window !== 'undefined' && currentProjectId && currentLibraryId) {
      window.dispatchEvent(
        new CustomEvent('library-version-control-toggle', {
          detail: {
            projectId: currentProjectId,
            libraryId: currentLibraryId,
            // Explicit desired state avoids ambiguous toggle races with retries.
            open: !libraryVersionControlOpen,
          },
        })
      );
    }
  };

  const handleSearchResultClick = (result: SearchResult) => {
    setIsSearchDropdownOpen(false);
    setIsSearchFocused(false);

    if (!result.projectId || !result.id) return;

    if (result.type === 'project') {
      router.push(`/${result.projectId}`);
      return;
    }

    if (result.type === 'folder') {
      router.push(`/${result.projectId}/folder/${result.id}`);
      return;
    }

    if (result.type === 'library') {
      router.push(`/${result.projectId}/${result.id}`);
      return;
    }
  };

  const renderSearchResultIcon = (type: SearchResultType) => {
    if (type === 'project') {
      return (
        <svg
          width="30"
          height="30"
          viewBox="0 0 30 30"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={styles.searchResultIconSvg}
        >
          <rect
            width="30"
            height="30"
            rx="15"
            fill="#0B99FF"
            fillOpacity="0.08"
          />
          <path
            d="M9.12836 11.5836L14.9983 14.9791L20.8681 11.5836"
            stroke="#070707"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14.9983 21.75V14.9724"
            stroke="#21272A"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M15 8.25L20.8457 11.625V18.375L15 21.75L9.15433 18.375V11.625L15 8.25Z"
            stroke="black"
            strokeWidth="1.5"
          />
        </svg>
      );
    }

    if (type === 'folder') {
      return (
        <svg
          width="30"
          height="30"
          viewBox="0 0 30 30"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={styles.searchResultIconSvg}
        >
          <rect
            width="30"
            height="30"
            rx="15"
            fill="#0B99FF"
            fillOpacity="0.08"
          />
          <path
            d="M14.8623 9.03809L15.9873 9.41309L16.3174 9.52344L16.4463 9.84668L17.0078 11.25H22.5V21H8.25V9H14.7471L14.8623 9.03809ZM9.75 19.5H21V12.75H15.9922L15.8037 12.2783L15.1826 10.7266L14.502 10.5H9.75V19.5ZM13.875 13.125H10.875V11.625H13.875V13.125Z"
            fill="black"
            fillOpacity="0.9"
          />
        </svg>
      );
    }

    // library
    return (
      <svg
        width="30"
        height="30"
        viewBox="0 0 30 30"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={styles.searchResultIconSvg}
      >
        <rect
          width="30"
          height="30"
          rx="15"
          fill="#0B99FF"
          fillOpacity="0.08"
        />
        <path
          d="M15.0791 10.6254C17.1378 9.46389 19.6542 9.46389 21.7129 10.6254L22.1602 10.8774C22.1736 10.885 22.1864 10.8935 22.1992 10.9018C22.2048 10.9054 22.2104 10.9088 22.2158 10.9125C22.2486 10.935 22.2776 10.9611 22.3057 10.9877C22.3203 11.0016 22.3332 11.0167 22.3467 11.0317C22.3643 11.0513 22.3822 11.0701 22.3975 11.0912C22.4122 11.1116 22.4238 11.1339 22.4365 11.1557C22.448 11.1755 22.4602 11.1946 22.4697 11.2153C22.4808 11.239 22.4895 11.2635 22.498 11.2885C22.5051 11.3092 22.5114 11.3298 22.5166 11.351C22.5255 11.387 22.5337 11.4235 22.5371 11.4614C22.5379 11.4695 22.5376 11.4776 22.5381 11.4858C22.539 11.5005 22.541 11.5157 22.541 11.5307V20.4711C22.541 20.5394 22.5288 20.6046 22.5117 20.6674C22.5044 20.6943 22.4968 20.7212 22.4863 20.7475C22.4836 20.7543 22.4814 20.7613 22.4785 20.768C22.4681 20.7921 22.4575 20.8169 22.4443 20.8403C22.4141 20.8937 22.3762 20.94 22.3359 20.9829C22.3196 21.0002 22.3021 21.0159 22.2842 21.0317C22.2658 21.0479 22.2473 21.0634 22.2275 21.0776C22.2103 21.09 22.1922 21.1008 22.1738 21.1118C22.1495 21.1262 22.1253 21.1402 22.0996 21.1518C22.0821 21.1597 22.0641 21.1657 22.0459 21.1723C22.0188 21.1821 21.9919 21.191 21.9639 21.1977C21.9269 21.2064 21.8895 21.2142 21.8506 21.2172H21.8486C21.8296 21.2187 21.8104 21.2211 21.791 21.2211C21.763 21.2211 21.7353 21.2193 21.708 21.2162C21.705 21.2159 21.7022 21.2147 21.6992 21.2143C21.6657 21.2102 21.6336 21.2012 21.6016 21.1928C21.5409 21.1768 21.4801 21.1567 21.4229 21.1245L20.9756 20.8725C19.3742 19.9689 17.4168 19.9688 15.8154 20.8725L15.3691 21.1245C15.3452 21.1379 15.3198 21.148 15.2949 21.1586C15.2932 21.1594 15.2918 21.1608 15.29 21.1616C15.2484 21.179 15.2056 21.192 15.1621 21.2016C15.1479 21.2047 15.1337 21.2081 15.1191 21.2104C15.1078 21.2122 15.0964 21.214 15.085 21.2153C15.0571 21.2184 15.0288 21.2211 15 21.2211L14.9229 21.2172C14.8925 21.2141 14.8631 21.2072 14.834 21.2006C14.7925 21.1912 14.7516 21.1791 14.7119 21.1625C14.7069 21.1605 14.7022 21.1579 14.6973 21.1557C14.6753 21.146 14.653 21.1364 14.6318 21.1245L14.1846 20.8725C12.5833 19.969 10.6257 19.969 9.02441 20.8725L8.57715 21.1245C8.5202 21.1565 8.4598 21.1768 8.39941 21.1928C8.36678 21.2014 8.33402 21.2102 8.2998 21.2143C8.29684 21.2147 8.29398 21.2159 8.29102 21.2162C8.26407 21.2192 8.23671 21.2211 8.20898 21.2211C8.18926 21.2211 8.16973 21.2187 8.15039 21.2172H8.14844C8.10959 21.2141 8.07211 21.2065 8.03516 21.1977C8.00718 21.191 7.98016 21.1821 7.95312 21.1723C7.93527 21.1658 7.91758 21.1596 7.90039 21.1518C7.87165 21.1388 7.84441 21.1235 7.81738 21.1069C7.80403 21.0986 7.79013 21.0915 7.77734 21.0825C7.75297 21.0653 7.73038 21.046 7.70801 21.0258C7.69275 21.012 7.67814 20.9978 7.66406 20.9829C7.62383 20.94 7.58588 20.8937 7.55566 20.8403C7.54247 20.8169 7.53192 20.7921 7.52148 20.768C7.51922 20.7628 7.51679 20.7577 7.51465 20.7524C7.5014 20.7198 7.49276 20.6862 7.48438 20.6528C7.47706 20.6236 7.4696 20.5943 7.46582 20.5639C7.46533 20.56 7.46429 20.5561 7.46387 20.5522C7.46099 20.5255 7.459 20.4985 7.45898 20.4711V11.5307C7.45898 11.5157 7.46105 11.5005 7.46191 11.4858C7.46241 11.4776 7.46213 11.4695 7.46289 11.4614C7.46612 11.4259 7.47345 11.3917 7.48145 11.3579C7.48762 11.3319 7.496 11.3068 7.50488 11.2817C7.51284 11.2591 7.52028 11.2368 7.53027 11.2153C7.53985 11.1946 7.55201 11.1755 7.56348 11.1557C7.57618 11.1339 7.58777 11.1116 7.60254 11.0912C7.61688 11.0714 7.63304 11.0531 7.64941 11.0346C7.66459 11.0175 7.67963 11.0005 7.69629 10.9848C7.72432 10.9585 7.75354 10.9328 7.78613 10.9106C7.78963 10.9082 7.79333 10.9061 7.79688 10.9037C7.81106 10.8944 7.82583 10.8858 7.84082 10.8774L8.28809 10.6254C10.3468 9.46395 12.8632 9.4639 14.9219 10.6254L15 10.6694L15.0791 10.6254ZM14.1846 11.9311C12.5833 11.0277 10.6256 11.0277 9.02441 11.9311L8.95898 11.9672V19.2368C10.6487 18.5165 12.5603 18.5164 14.25 19.2368V11.9672L14.1846 11.9311ZM20.9756 11.9311C19.3744 11.0277 17.4166 11.0277 15.8154 11.9311L15.75 11.9672V19.2368C17.4398 18.5164 19.3512 18.5163 21.041 19.2368V11.9672L20.9756 11.9311Z"
          fill="black"
          fillOpacity="0.9"
        />
      </svg>
    );
  };

  const renderRightContent = () => {
    if (onSimulationSystem) {
      return null;
    }

    if (onScriptSystem && currentProjectId) {
      const isScriptSplitPage =
        !!currentLibraryId &&
        (pathname?.includes(`/script-system/${currentProjectId}/script/`) ??
          false);

      return (
        <ScriptTopBarActions
          projectId={currentProjectId}
          projectName={shareProjectName}
          userRole={(userRole || 'viewer') as CollaboratorRole}
          libraryId={currentLibraryId}
          showFlowChartToggle={isScriptSplitPage}
          presenceUsers={currentDocumentId ? topbarDocumentPresenceUsers : []}
          currentUserId={userProfile?.id ?? null}
          currentUserName={displayName}
          currentUserEmail={userProfile?.email || ''}
          currentUserAvatarColor={userAvatarColor}
        />
      );
    }

    if (isDocumentDetail) {
      return (
        <>
          {userProfile ? (
            <PresenceMembersStack
              presenceUsers={topbarDocumentPresenceUsers}
              currentUserId={userProfile.id}
              currentUserName={displayName}
              currentUserEmail={userProfile.email || ''}
              currentUserAvatarColor={userAvatarColor}
              emptyViewingMessage="No one else is currently viewing this document"
            />
          ) : null}
          <ShareButton onClick={() => setShowInviteModal(true)} />
          <Dropdown
            menu={{
              items: documentExportItems,
              onClick: ({ key }) => handleDocumentExport(key),
            }}
            placement="bottomRight"
            trigger={['click']}
          >
            <button
              type="button"
              className={styles.documentActionButton}
              aria-label="Export document"
              data-testid="document-export"
              title="Export document"
            >
              <DownloadOutlined aria-hidden="true" />
            </button>
          </Dropdown>
          <button
            type="button"
            className={styles.documentActionButton}
            aria-label="Version history"
            data-testid="version-history-toggle"
            title="Version history"
            onClick={handleDocumentHistoryToggle}
          >
            <HistoryOutlined aria-hidden="true" />
          </button>
        </>
      );
    }

    if (isPredefine) {
      return (
        <>
          <button
            className={styles.topbarPillButton}
            onClick={handlePredefinePublish}
          >
            <span className={styles.topbarPillIcon}>
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-16">
                <g clipPath="url(#clip0_1420_347)">
                  <path d="M8 8.6665L5.66666 10.9998M8 14.6665V8.6665V14.6665ZM8 8.6665L10.3333 10.9998L8 8.6665Z" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.3333 11.7384C14.3291 11.3482 15.3333 10.4594 15.3333 8.66683C15.3333 6.00016 13.1111 5.3335 12 5.3335C12 4.00016 12 1.3335 8 1.3335C4 1.3335 4 4.00016 4 5.3335C2.88888 5.3335 0.666664 6.00016 0.666664 8.66683C0.666664 10.4594 1.67085 11.3482 2.66666 11.7384" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </g>
                <defs>
                  <clipPath id="clip0_1420_347">
                    <rect width="16" height="16" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </span>
            <span>Publish</span>
          </button>
        </>
      );
    }

    if (isLibraryTopLevelPage && currentLibraryId && currentProjectId && userProfile) {
      const lastBreadcrumb = displayBreadcrumbs[displayBreadcrumbs.length - 1];
      const libraryName = lastBreadcrumb?.label || 'Library';

      return (
        <LibraryHeader
          libraryId={currentLibraryId}
          libraryName={libraryName}
          libraryDescription={null}
          projectId={currentProjectId}
          currentUserId={userProfile.id}
          currentUserName={displayName}
          currentUserEmail={userProfile.email || ''}
          currentUserAvatarColor={userAvatarColor}
          userRole={(userRole || 'viewer') as CollaboratorRole}
          presenceUsers={topbarPresenceUsers}
          isVersionControlOpen={libraryVersionControlOpen}
          onVersionControlToggle={handleTopbarVersionControlToggle}
        />
      );
    }

    if (onRecentPage && currentProjectId) {
      return (
        <LibraryToolbar
          mode="recent"
          title={shareProjectName}
          onCreateFolder={handleTopbarCreateFolder}
          onCreateLibrary={handleTopbarCreateLibrary}
          onCreateDocument={handleTopbarCreateDocument}
          onImportTable={handleTopbarImportTable}
          onImportDocument={handleTopbarImportDocument}
          viewMode={libraryViewMode}
          onViewModeChange={handleTopbarViewModeChange}
          userRole={userRole as CollaboratorRole | null}
          projectId={currentProjectId}
        />
      );
    }

    if (onAdminPage && currentProjectId) {
      return (
        <LibraryToolbar
          mode="admin"
          title="Settings"
          onCreateFolder={handleTopbarCreateFolder}
          onCreateLibrary={handleTopbarCreateLibrary}
          onCreateDocument={handleTopbarCreateDocument}
          onImportTable={handleTopbarImportTable}
          onImportDocument={handleTopbarImportDocument}
          userRole={userRole as CollaboratorRole | null}
          projectId={currentProjectId}
        />
      );
    }

    if ((isProjectRootPage || isFolderPage) && currentProjectId) {
      const lastBreadcrumb = displayBreadcrumbs[displayBreadcrumbs.length - 1];
      const title = lastBreadcrumb?.label;

      return (
        <LibraryToolbar
          mode={isFolderPage ? 'folder' : 'project'}
          title={title}
          onCreateFolder={handleTopbarCreateFolder}
          onCreateLibrary={handleTopbarCreateLibrary}
          onCreateDocument={handleTopbarCreateDocument}
          onImportTable={handleTopbarImportTable}
          onImportDocument={handleTopbarImportDocument}
          viewMode={libraryViewMode}
          onViewModeChange={handleTopbarViewModeChange}
          userRole={userRole as CollaboratorRole | null}
          projectId={currentProjectId}
        />
      );
    }

    if (isAssetDetail) {
      if (isCreatingNewAsset) {
        // Create mode - show Create Asset button
        return (
          <>
            <button
              className={`${styles.topbarPillButton} ${styles.topbarPillPrimary}`}
              onClick={handleCreateAsset}
            >
              <span className={styles.topbarPillIcon}>
                <Image src={topbarPredefinePublishIcon} alt="Create" width={16} height={16} className="icon-16" />
              </span>
              <span>Create Asset</span>
            </button>
            <button className={`${styles.button} ${styles.buttonText}`}>
              <Image src={homeMorehorizontalIcon} alt="More" width={20} height={20} className="icon-20" />
            </button>
            <button className={styles.button}>
              <Image src={homeQuestionIcon} alt="Question" width={20} height={20} className="icon-20" />
            </button>
            <button className={styles.button}>
              <Image src={homeMessageIcon} alt="Message" width={20} height={20} className="icon-20" />
            </button>
          </>
        );
      } else {

      }
    }

    // Default icon group
    return (
      <>
        <button className={`${styles.button} ${styles.buttonText}`}>
          <Image src={homeMorehorizontalIcon} alt="More" width={20} height={20} className="icon-20" />
        </button>
        <button className={styles.button}>
          <Image src={homeQuestionIcon} alt="Question" width={20} height={20} className="icon-20" />
        </button>
        <button className={styles.button}>
          <Image src={homeMessageIcon} alt="Message" width={20} height={20} className="icon-20" />
        </button>
      </>
    );
  };

  return (
    <header className={`${styles.header} ${onSimulationSystem ? styles.headerSimulation : ''} ${onCreateMap ? styles.headerCreateMap : ''}`}>
      <div className={styles.left}>
        {showCreateProjectBreadcrumb ? (
          <div className={styles.createProjectBreadcrumb}>
            <Image src={menuIcon} alt="Menu" width={36} height={48} className={`icon-menu ${styles.menuIcon}`} />
            <span className={styles.createProjectText}>Create Project</span>
          </div>
        ) : (
          <div className={styles.breadcrumb}>
            <Image src={topBarBreadCrumbIcon}
              alt="Breadcrumb"
              width={24} height={24} className="icon-24"
              style={{ marginRight: '5px', cursor: 'pointer' }}
              onClick={handleSidebarToggle}
            />
            {onSimulationSystem ? (
              <div className={styles.simulationHeaderSlot} data-simulation-header-slot />
            ) : (
              displayBreadcrumbs.map((item, index) => {
                const isLast = index === displayBreadcrumbs.length - 1;
                const label = isLast && isAssetDetail ? 'asset' : item.label;
                const displayLabel =
                  label && label.length > 25 ? `${label.slice(0, 25)}...` : label;

                return (
                  <span key={index}>
                    <button
                      className={`${styles.breadcrumbItem} ${isLast ? styles.breadcrumbItemActive : styles.breadcrumbItemClickable
                        }`}
                      onClick={() => handleBreadcrumbClick(item.path, index)}
                      disabled={isLast}
                    >
                      {displayLabel}
                    </button>
                    {index < displayBreadcrumbs.length - 1 && (
                      <span className={styles.breadcrumbSeparator}> / </span>
                    )}
                  </span>
                );
              })
            )}
          </div>
        )}
      </div>
      <div className={styles.searchContainer} ref={searchContainerRef}>
        <label
          className={`${styles.searchLabel} ${isSearchFocused ? styles.searchLabelFocused : ''
            }`}
        >
          <Image
            src={searchIcon}
            alt="Search"
            width={24}
            height={24}
            className={`icon-24 ${styles.searchIcon}`}
          />
          <input
            placeholder={searchFilter === 'cell' ? 'Find in cell values...' : 'Search for...'}
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => {
              const value = e.target.value;
              const wasNonEmpty = searchQuery.trim().length > 0;
              const isNowEmpty = value.trim().length === 0;
              setSearchQuery(value);
              if (wasNonEmpty && isNowEmpty) {
                clearCellSearchFocusState();
              }
              // Show search results when input exists; otherwise show recent records.
              setIsSearchDropdownOpen(true);
            }}
            onFocus={() => {
              setIsSearchFocused(true);
              // On focus, show matches for a query or recent records for empty input.
              setIsSearchDropdownOpen(true);
              if (searchFilter === 'cell' && searchQuery.trim().length > 0) {
                setCellSearchRefreshKey((k) => k + 1);
              }
            }}
          />
          {searchQuery.trim().length > 0 && (
            <div className={styles.searchActions}>
              <button
                type="button"
                className={styles.searchActionButton}
                aria-label="Clear search"
                title="Clear search"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSearchQuery('');
                  setIsSearchDropdownOpen(true);
                  clearCellSearchFocusState();
                }}
              >
                ×
              </button>
            </div>
          )}
        </label>
        {isSearchDropdownOpen && (
          <div className={styles.searchDropdown}>
            <div
              className={`${styles.searchTabs} ${searchFilter === 'cell' ? styles.searchTabsCell : ''}`}
            >
              {searchFilter === 'cell' ? (
                <div className={styles.searchTabsRow}>
                  <button
                    type="button"
                    className={`${styles.searchTab} ${styles.searchTabCellActive}`}
                    onClick={() => setSearchFilter('all')}
                  >
                    <span className={styles.cellSearchTabIcon}>
                      <CellContentIcon size={16} withBackground={false} />
                    </span>
                    Find or replace cell content
                  </button>
                </div>
              ) : (
                <>
                  <div className={styles.searchTabsRow}>
                    <button
                      type="button"
                      className={`${styles.searchTab} ${styles.searchTabCell}`}
                      onClick={() => setSearchFilter('cell')}
                    >
                      <span className={styles.cellSearchTabIcon}>
                        <CellContentIcon size={16} withBackground={false} />
                      </span>
                      Find or replace cell content
                    </button>
                  </div>
                  <div className={styles.searchTabsRow}>
                    {[
                      { key: 'all', label: 'All' },
                      { key: 'project', label: 'Project' },
                      { key: 'folder', label: 'Folder' },
                      { key: 'library', label: 'Library' },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className={`${styles.searchTab} ${searchFilter === tab.key ? styles.searchTabActive : ''
                          }`}
                        onClick={() =>
                          setSearchFilter(tab.key as 'all' | 'project' | 'folder' | 'library' | 'cell')
                        }
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {searchFilter === 'cell' && searchQuery.trim().length > 0 && (
              <div className={styles.cellReplaceRow}>
                <label className={styles.cellReplaceField}>
                  <span className={styles.cellReplaceLabel}>Replace with</span>
                  <input
                    type="text"
                    className={styles.cellReplaceInput}
                    placeholder="replacement text"
                    value={cellReplaceText}
                    onChange={(e) => setCellReplaceText(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </label>
              </div>
            )}
            <div
              className={
                searchFilter === 'cell'
                  ? styles.cellSearchResultsLabel
                  : styles.searchResultSectionLabel
              }
            >
              results
            </div>
            <div
              className={`${styles.searchDropdownInner} ${
                searchFilter === 'cell' ? styles.searchDropdownInnerCell : ''
              }`}
            >
              {searchFilter === 'cell' ? (
                cellSearchLoading ? (
                  <div className={styles.cellSearchLoading}>Searching...</div>
                ) : pagedCellSearchHits.length > 0 ? (
                  <div className={styles.cellSearchHitGrid}>
                    {pagedCellSearchHits.map((hit, index) => (
                      <div
                        key={`${hit.assetId}-${hit.fieldId}-${hit.valueSnippet}-${index}`}
                        className={styles.cellSearchHitCard}
                      >
                        <button
                          type="button"
                          className={styles.cellSearchHitMain}
                          onClick={() => {
                            setIsSearchDropdownOpen(false);
                            setIsSearchFocused(false);
                            navigateToCellHit(hit);
                          }}
                        >
                          <span className={styles.cellSearchHitIcon}>
                            <CellContentIcon size={30} />
                          </span>
                          <div className={styles.cellSearchHitMeta}>
                            <CellHitLocationLabel
                              fieldLabel={hit.fieldLabel}
                              libraryName={hit.libraryName}
                            />
                            <div className={styles.cellSearchHitValue}>
                              &quot;
                              {highlightCellValue(
                                getCellValuePreview(hit.valueSnippet),
                                searchQuery
                              )}
                              &quot;
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          className={styles.cellReplaceOneButton}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openCellReplaceConfirm('single', hit);
                          }}
                        >
                          Replace
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.cellSearchEmpty}>No matches.</div>
                )
              ) : filteredSearchResults.length > 0 ? (
                filteredSearchResults.map((item) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    className={styles.searchResultItem}
                    onClick={() => handleSearchResultClick(item)}
                  >
                    <div className={styles.searchResultLeft}>
                      {renderSearchResultIcon(item.type)}
                      <div className={styles.searchResultMain}>
                        <span className={styles.searchResultName}>
                          {highlightMatch(
                            item.name && item.name.length > 30
                              ? `${item.name.slice(0, 30)}...`
                              : item.name,
                            searchQuery
                          )}
                        </span>
                        {item.type !== 'project' && item.hierarchy && (
                          <span className={styles.searchResultParent}>{item.hierarchy}</span>
                        )}
                      </div>
                    </div>
                    <span className={styles.searchResultType}>
                      {formatUpdatedAtLabel(item.updatedAt)}
                    </span>
                  </button>
                ))
              ) : searchQuery.trim().length > 0 ? (
                <div className={styles.cellSearchEmpty}>No matches.</div>
              ) : null}
            </div>
            {searchFilter === 'cell' && !cellSearchLoading && cellSearchHits.length > 0 && (
              <div className={styles.cellSearchFooter}>
                <button
                  type="button"
                  className={styles.cellReplaceAllButton}
                  disabled={!searchQuery.trim()}
                  onClick={() => openCellReplaceConfirm('all')}
                >
                  Replace all ({cellSearchHits.length})
                </button>
                <div className={styles.cellSearchPagination}>
                  <button
                    type="button"
                    className={styles.cellSearchPaginationButton}
                    onClick={() => setCellSearchPage((p) => Math.max(1, p - 1))}
                    disabled={cellSearchPage <= 1}
                  >
                    Prev
                  </button>
                  <span className={styles.cellSearchPaginationLabel}>
                    {cellSearchPage}/{cellSearchTotalPages}
                  </span>
                  <button
                    type="button"
                    className={styles.cellSearchPaginationButton}
                    onClick={() => setCellSearchPage((p) => Math.min(cellSearchTotalPages, p + 1))}
                    disabled={cellSearchPage >= cellSearchTotalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.right}>
        {renderRightContent()}
        <div className={styles.userContainer} ref={menuRef}>
          <button
            className={styles.userAvatar}
            onClick={() => setShowUserMenu(!showUserMenu)}
            aria-label="User menu"
            data-testid="user-menu"
            type="button"
          >
            {userProfile ? (
              <Avatar
                size={30}
                style={{
                  backgroundColor: userAvatarColor,
                  borderRadius: '16px',
                  cursor: 'pointer',
                  fontSize: '21px',
                  fontWeight: 600,
                }}
              >
                {avatarInitial}
              </Avatar>
            ) : (
              /* Fallback avatar icon for guests */
              <Image src={homeDefaultUserIcon} alt="User" width={20} height={20} className="icon-20" />
            )}
          </button>
          {showUserMenu && (
            <div className={styles.userMenu}>
              <button
                type="button"
                className={styles.userMenuItem}
                onClick={handleMcpNavigation}
              >
                MCP
              </button>
              <button
                type="button"
                className={styles.userMenuItem}
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {cellReplaceModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className={dialog.backdrop}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !cellReplaceLoading) {
                setCellReplaceModalOpen(false);
                setCellReplacePreview(null);
              }
            }}
          >
            <div
              className={`${dialog.modal} ${dialog.modalCompact} ${styles.cellReplaceConfirmModal}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cell-replace-confirm-title"
            >
              <div className={dialog.header}>
                <div id="cell-replace-confirm-title" className={dialog.title}>
                  {cellReplacePendingMode === 'all'
                    ? 'Replace all matching cells'
                    : 'Replace cell value'}
                </div>
                <button
                  type="button"
                  className={dialog.close}
                  onClick={() => {
                    if (!cellReplaceLoading) {
                      setCellReplaceModalOpen(false);
                      setCellReplacePreview(null);
                    }
                  }}
                  aria-label="Close"
                  disabled={cellReplaceLoading}
                >
                  <Image src={closeIcon} alt="" width={32} height={32} className="icon-32" />
                </button>
              </div>

              <div className={styles.cellReplaceConfirmBody}>
                {cellReplaceLoading && !cellReplacePreview ? (
                  <p>Validating types...</p>
                ) : (
                  <p>Are you sure you want to replace?</p>
                )}
              </div>

              <div className={dialog.footer}>
                <button
                  type="button"
                  className={`${dialog.button} ${dialog.buttonAuto} ${dialog.secondary} ${dialog.importCancel}`}
                  onClick={() => {
                    if (!cellReplaceLoading) {
                      setCellReplaceModalOpen(false);
                      setCellReplacePreview(null);
                    }
                  }}
                  disabled={cellReplaceLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${dialog.button} ${dialog.importSubmit}`}
                  onClick={() => void confirmCellReplace()}
                  disabled={cellReplaceLoading}
                >
                  {cellReplaceLoading && cellReplacePreview
                    ? 'Replacing...'
                    : 'Confirm replace'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {isDocumentDetail && currentProjectId && (
        <InviteCollaboratorModal
          projectId={currentProjectId}
          projectName={shareProjectName}
          userRole={(userRole || 'viewer') as CollaboratorRole}
          open={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          onSuccess={(_email, message) => {
            showSuccessToast(message);
          }}
          title={`Share ${shareProjectName}..`}
        />
      )}
    </header>
  );
}
