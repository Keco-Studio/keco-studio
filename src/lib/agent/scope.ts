/**
 * Conversation scope binding.
 *
 * A conversation's data range (project / folder / table) is snapshotted once at
 * creation time from the user's live navigation, then used as the authoritative
 * source on every subsequent turn. This freezes the agent to the project it was
 * opened in — switching the UI to another project never re-targets an existing
 * conversation.
 */

import type { AgentWorkspace, ConversationScope, ToolContext } from './types';

/** Live-navigation fields sent by the client when a turn starts. */
export interface NavigationInput {
  projectId?: string;
  workspace?: AgentWorkspace;
  currentFolderId?: string;
  currentFolderName?: string;
  currentLibraryId?: string;
  currentLibraryName?: string;
}

/**
 * Determine the scope level from live navigation, finest to coarsest:
 * table (library selected) > folder > project > global (nothing selected).
 */
export function resolveScopeFromNavigation(nav: NavigationInput): ConversationScope {
  const workspace = nav.workspace ? { workspace: nav.workspace } : {};
  if (nav.currentLibraryId) {
    return {
      level: 'table',
      ...workspace,
      projectId: nav.projectId,
      folderId: nav.currentFolderId,
      folderName: nav.currentFolderName,
      libraryId: nav.currentLibraryId,
      libraryName: nav.currentLibraryName,
    };
  }
  if (nav.currentFolderId) {
    return {
      level: 'folder',
      ...workspace,
      projectId: nav.projectId,
      folderId: nav.currentFolderId,
      folderName: nav.currentFolderName,
    };
  }
  if (nav.projectId) {
    return { level: 'project', projectId: nav.projectId, ...workspace };
  }
  return { level: 'global', ...workspace };
}

/** Navigation-related subset of ToolContext derived from a bound scope. */
export type ScopeContextFields = Pick<
  ToolContext,
  | 'projectId'
  | 'currentFolderId'
  | 'currentFolderName'
  | 'currentLibraryId'
  | 'currentLibraryName'
  | 'workspace'
>;

/**
 * Build the navigation fields of a ToolContext from a conversation's bound
 * scope, ignoring the client's live navigation. Legacy conversations without a
 * scope degrade to the project level using the conversation's own project id.
 */
export function contextFieldsFromScope(
  scope: ConversationScope | undefined,
  fallbackProjectId: string
): ScopeContextFields {
  if (!scope) {
    return { projectId: fallbackProjectId };
  }
  const workspace = scope.workspace ? { workspace: scope.workspace } : {};
  return {
    projectId: scope.projectId ?? fallbackProjectId,
    ...workspace,
    currentFolderId: scope.folderId,
    currentFolderName: scope.folderName,
    currentLibraryId: scope.libraryId,
    currentLibraryName: scope.libraryName,
  };
}
