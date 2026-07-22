export type ProjectRole = 'admin' | 'editor' | 'viewer';

export type ProjectRoleResult = {
  role: ProjectRole | null;
  isOwner: boolean;
};

export type FetchProjectRoleOptions = {
  maxAttempts?: number;
  delayMs?: number;
};

const DEFAULT_MAX_ATTEMPTS = 15;
const DEFAULT_DELAY_MS = 2000;

function isRetryableStatus(status: number): boolean {
  // 404: project may not be visible yet right after creation.
  // 5xx / network-ish failures: transient.
  return status === 404 || status >= 500;
}

/**
 * Fetches project role with retries. Role can lag briefly after project creation in CI.
 * Definitive auth failures (401/403) return immediately without retrying.
 */
export async function fetchProjectRoleWithRetry(
  projectId: string,
  accessToken: string,
  options: FetchProjectRoleOptions = {}
): Promise<ProjectRoleResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  let lastResult: ProjectRoleResult = { role: null, isOwner: false };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const roleResponse = await fetch(`/api/projects/${projectId}/role`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (roleResponse.status === 401 || roleResponse.status === 403) {
        return { role: null, isOwner: false };
      }

      if (roleResponse.ok) {
        const roleResult = (await roleResponse.json()) as ProjectRoleResult;
        lastResult = {
          role: roleResult.role ?? null,
          isOwner: roleResult.isOwner ?? false,
        };

        if (lastResult.role !== null) {
          return lastResult;
        }

        // 200 with null role is unexpected for authorized callers; treat as
        // definitive denial rather than spinning for ~30s.
        return lastResult;
      }

      if (!isRetryableStatus(roleResponse.status) || attempt === maxAttempts - 1) {
        return lastResult;
      }
    } catch (error) {
      console.error('[fetchProjectRoleWithRetry] Error fetching role:', error);
      if (attempt === maxAttempts - 1) {
        return lastResult;
      }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return lastResult;
}
