import type { QueryClient } from '@tanstack/react-query';

export const createMapAgentRefreshKey = ['create-map', 'agent-refresh'] as const;

export type CreateMapAgentRefresh = {
  projectId: string;
  mapId?: string;
  sequence: number;
};

export function publishCreateMapAgentRefresh(
  queryClient: QueryClient,
  detail: { projectId: string; mapId?: string },
): void {
  queryClient.setQueryData<CreateMapAgentRefresh>(createMapAgentRefreshKey, (previous) => ({
    ...detail,
    sequence: (previous?.sequence ?? 0) + 1,
  }));
}
