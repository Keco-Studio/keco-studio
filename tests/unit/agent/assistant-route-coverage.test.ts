import { deriveAgentWorkspaceContext, type AgentNavigationContext } from '@/lib/agent/client-workspace';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const DOCUMENT = '22222222-2222-4222-8222-222222222222';
const LIBRARY = '33333333-3333-4333-8333-333333333333';
const FOLDER = '44444444-4444-4444-8444-444444444444';

const navigation: AgentNavigationContext = {
  currentProjectId: PROJECT,
  currentProjectName: 'Atlas',
  currentDocumentId: DOCUMENT,
  currentFolderId: FOLDER,
  currentFolderName: 'Scenes',
  currentLibraryId: LIBRARY,
  currentLibraryName: 'Characters',
};

describe('global assistant route coverage', () => {
  it.each([
    ['/projects', 'projects', undefined],
    [`/${PROJECT}`, 'studio', PROJECT],
    [`/${PROJECT}/recent`, 'studio', PROJECT],
    [`/${PROJECT}/folder/${FOLDER}`, 'studio', PROJECT],
    [`/${PROJECT}/doc/${DOCUMENT}`, 'studio', PROJECT],
    [`/${PROJECT}/${LIBRARY}`, 'studio', PROJECT],
    [`/${PROJECT}/${LIBRARY}/predefine`, 'studio', PROJECT],
    [`/${PROJECT}/${LIBRARY}/asset-1`, 'studio', PROJECT],
    [`/${PROJECT}/admin/assets`, 'studio', PROJECT],
    ['/script-system', 'script', undefined],
    [`/script-system/${PROJECT}`, 'script', PROJECT],
    [`/script-system/${PROJECT}/doc/${DOCUMENT}`, 'script', PROJECT],
    [`/script-system/${PROJECT}/open/${DOCUMENT}`, 'script', PROJECT],
    [`/script-system/${PROJECT}/script/${LIBRARY}`, 'script', PROJECT],
    ['/create-map', 'create-map', PROJECT],
    ['/create-map/history', 'create-map', PROJECT],
    ['/game-design-systems', 'game-design-systems', undefined],
    ['/game-design-systems/create', 'game-design-systems', undefined],
  ])('maps %s to %s workspace', (path, workspace, projectId) => {
    expect(deriveAgentWorkspaceContext(path, navigation, {
      projectId: PROJECT, projectName: 'Map hint',
    })).toMatchObject({ workspace, ...(projectId ? { projectId } : {}) });
  });

  it('keeps route context precise across special workspaces', () => {
    expect(deriveAgentWorkspaceContext(`/script-system/${PROJECT}/doc/${DOCUMENT}`, navigation, null))
      .toMatchObject({ workspace: 'script', currentDocumentId: DOCUMENT, projectName: 'Atlas' });
    expect(deriveAgentWorkspaceContext(`/script-system/${PROJECT}/script/${LIBRARY}`, navigation, null))
      .toMatchObject({ workspace: 'script', currentLibraryId: LIBRARY, currentLibraryName: 'Characters' });
    expect(deriveAgentWorkspaceContext(`/${PROJECT}/doc/${DOCUMENT}`, navigation, null))
      .toMatchObject({ workspace: 'studio', currentDocumentId: DOCUMENT, currentFolderId: FOLDER });
    expect(deriveAgentWorkspaceContext('/create-map', navigation, null)).toEqual({
      workspace: 'create-map', projectId: undefined, projectName: undefined,
    });
    expect(deriveAgentWorkspaceContext('/game-design-systems/create', navigation, null))
      .toEqual({ workspace: 'game-design-systems' });
  });

  it.each([
    '/', '/simulation-system', '/simulation-system/economy/overview',
    '/account', '/billing', '/mcp', '/keco-admin', '/keco-101',
    '/auth/callback', '/auth/reset-password', '/accept-invitation',
    '/decline-invitation', '/forgot-password', '/oauth/consent',
    '/payment/success', '/payment/cancel', '/unknown-static-route',
    '/script-system/not-a-project',
  ])('excludes %s', (path) => {
    expect(deriveAgentWorkspaceContext(path, navigation, null)).toBeNull();
  });

  it('does not use stale navigation values for a different project', () => {
    const other = '55555555-5555-4555-8555-555555555555';
    expect(deriveAgentWorkspaceContext(`/${other}/doc/${DOCUMENT}`, navigation, null)).toEqual({
      workspace: 'studio', projectId: other, projectName: undefined,
      currentDocumentId: DOCUMENT, currentFolderId: undefined,
      currentFolderName: undefined, currentLibraryId: undefined,
      currentLibraryName: undefined,
    });
  });
});
