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

/**
 * Fetches project role with retries. Role can lag briefly after project creation in CI.
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

      if (roleResponse.ok) {
        const roleResult = (await roleResponse.json()) as ProjectRoleResult;
        lastResult = {
          role: roleResult.role ?? null,
          isOwner: roleResult.isOwner ?? false,
        };

        if (lastResult.role !== null) {
          return lastResult;
        }
      }
    } catch (error) {
      console.error('[fetchProjectRoleWithRetry] Error fetching role:', error);
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return lastResult;
}
