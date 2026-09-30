import type { AgentWorkspace } from './types';
import type { CreateMapProjectPreference } from '@/lib/create-map/projectPreference';
import { isUuid } from '@/lib/utils/uuid';

export type AgentWorkspaceContext = {
  workspace: AgentWorkspace;
  projectId?: string;
  projectName?: string;
  currentDocumentId?: string;
  currentFolderId?: string;
  currentFolderName?: string;
  currentLibraryId?: string;
  currentLibraryName?: string;
};

export type AgentNavigationContext = {
  currentProjectId: string | null;
  currentProjectName: string | null;
  currentDocumentId: string | null;
  currentFolderId: string | null;
  currentFolderName: string | null;
  currentLibraryId: string | null;
  currentLibraryName: string | null;
};

const EXCLUDED_ROOTS = new Set([
  'simulation-system', 'account', 'billing', 'mcp', 'keco-admin', 'keco-101',
  'auth', 'accept-invitation', 'decline-invitation', 'forgot-password',
  'oauth', 'payment',
]);

export function deriveAgentWorkspaceContext(
  pathname: string | null,
  navigation: AgentNavigationContext,
  createMapPreference: CreateMapProjectPreference | null
): AgentWorkspaceContext | null {
  const parts = (pathname ?? '').split('/').filter(Boolean);
  const root = parts[0];
  if (!root || EXCLUDED_ROOTS.has(root)) return null;

  if (root === 'projects') {
    return parts.length === 1 ? { workspace: 'projects' } : null;
  }
  if (root === 'create-map') {
    return {
      workspace: 'create-map',
      // Persisted selection is a client hint; server authorization still checks it.
      projectId: createMapPreference?.projectId || undefined,
      projectName: createMapPreference?.projectName || undefined,
    };
  }
  if (root === 'game-design-systems') return { workspace: 'game-design-systems' };

  if (root === 'script-system') {
    const projectId = parts[1];
    if (!projectId) return { workspace: 'script' };
    if (!isUuid(projectId) && navigation.currentProjectId !== projectId) return null;
    const navigationMatches = navigation.currentProjectId === projectId;
    return {
      workspace: 'script',
      projectId,
      projectName: navigationMatches ? navigation.currentProjectName || undefined : undefined,
      currentDocumentId: parts[2] === 'doc' || parts[2] === 'open' ? parts[3] : undefined,
      currentLibraryId: parts[2] === 'script' ? parts[3] : undefined,
      currentLibraryName: navigationMatches && parts[2] === 'script'
        ? navigation.currentLibraryName || undefined : undefined,
    };
  }

  const projectId = root;
  if (!isUuid(projectId) && navigation.currentProjectId !== projectId) return null;
  const navigationMatches = navigation.currentProjectId === projectId;
  return {
    workspace: 'studio',
    projectId,
    projectName: navigationMatches ? navigation.currentProjectName || undefined : undefined,
    currentDocumentId: parts[1] === 'doc' ? parts[2] : undefined,
    currentFolderId: navigationMatches ? navigation.currentFolderId || undefined : undefined,
    currentFolderName: navigationMatches ? navigation.currentFolderName || undefined : undefined,
    currentLibraryId: navigationMatches ? navigation.currentLibraryId || undefined : undefined,
    currentLibraryName: navigationMatches ? navigation.currentLibraryName || undefined : undefined,
  };
}
