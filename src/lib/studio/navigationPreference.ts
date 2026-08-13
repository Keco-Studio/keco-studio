export type StudioNavigationPreference = {
  projectId: string;
  fileHref: string | null;
};

const STORAGE_PREFIX = 'keco.studio.navigationPreference';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStudioNavigationPreference(
  userId: string | null | undefined
): StudioNavigationPreference | null {
  if (!userId) return null;
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    const parsed = JSON.parse(storage.getItem(storageKey(userId)) ?? 'null') as Partial<StudioNavigationPreference> | null;
    if (!parsed || typeof parsed.projectId !== 'string' || !parsed.projectId) return null;
    return {
      projectId: parsed.projectId,
      fileHref: typeof parsed.fileHref === 'string' && parsed.fileHref ? parsed.fileHref : null,
    };
  } catch {
    return null;
  }
}

export function writeStudioProjectPreference(userId: string, projectId: string): void {
  const storage = getLocalStorage();
  if (!storage || !userId || !projectId) return;
  const current = readStudioNavigationPreference(userId);
  const next: StudioNavigationPreference = {
    projectId,
    fileHref: current?.projectId === projectId ? current.fileHref : null,
  };
  storage.setItem(storageKey(userId), JSON.stringify(next));
}

export function writeStudioFilePreference(
  userId: string,
  projectId: string,
  fileHref: string
): void {
  const storage = getLocalStorage();
  if (!storage || !userId || !projectId || !fileHref) return;
  storage.setItem(
    storageKey(userId),
    JSON.stringify({ projectId, fileHref } satisfies StudioNavigationPreference)
  );
}
