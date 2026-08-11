export type RecentVisitKind = 'table' | 'document';

export type RecentVisit = {
  kind: RecentVisitKind;
  id: string;
  projectId: string;
  name: string;
  href: string;
  visitedAt: string;
};

const STORAGE_PREFIX = 'keco.recentVisits';
const MAX_ITEMS = 30;

function getLocalStorage(): Storage | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return null;
    return storage;
  } catch {
    return null;
  }
}

function storageKey(userId: string, projectId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${projectId}`;
}

function normalizeVisit(item: unknown): RecentVisit | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Partial<RecentVisit> & {
    kind?: string;
    libraryId?: string | null;
  };

  if (typeof row.id !== 'string' || typeof row.projectId !== 'string') return null;
  if (typeof row.name !== 'string' || typeof row.href !== 'string') return null;
  if (typeof row.visitedAt !== 'string') return null;

  // New shape
  if (row.kind === 'table' || row.kind === 'document') {
    return {
      kind: row.kind,
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      href: row.href,
      visitedAt: row.visitedAt,
    };
  }

  // Legacy: library / asset visits map to tables
  if (row.kind === 'library') {
    return {
      kind: 'table',
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      href: row.href,
      visitedAt: row.visitedAt,
    };
  }

  if (row.kind === 'asset' && typeof row.libraryId === 'string' && row.libraryId) {
    const projectId = row.projectId;
    return {
      kind: 'table',
      id: row.libraryId,
      projectId,
      name: row.name.replace(/\s+asset$/i, '') || row.name,
      href: `/${projectId}/${row.libraryId}`,
      visitedAt: row.visitedAt,
    };
  }

  return null;
}

function safeParse(raw: string | null): RecentVisit[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const visits: RecentVisit[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const visit = normalizeVisit(item);
      if (!visit) continue;
      const key = `${visit.kind}:${visit.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      visits.push(visit);
    }
    return visits;
  } catch {
    return [];
  }
}

export function readRecentVisits(userId: string, projectId: string): RecentVisit[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  return safeParse(storage.getItem(storageKey(userId, projectId)));
}

export function writeRecentVisit(
  userId: string,
  visit: Omit<RecentVisit, 'visitedAt'> & { visitedAt?: string }
): RecentVisit[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  const nextVisit: RecentVisit = {
    ...visit,
    visitedAt: visit.visitedAt ?? new Date().toISOString(),
  };
  const existing = readRecentVisits(userId, visit.projectId).filter(
    (item) => !(item.kind === nextVisit.kind && item.id === nextVisit.id)
  );
  const next = [nextVisit, ...existing].slice(0, MAX_ITEMS);
  storage.setItem(storageKey(userId, visit.projectId), JSON.stringify(next));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('keco-recent-visits-changed', {
        detail: { userId, projectId: visit.projectId },
      })
    );
  }
  return next;
}
