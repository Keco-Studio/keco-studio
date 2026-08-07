import {
  resolveScopeFromNavigation,
  contextFieldsFromScope,
} from '../../../src/lib/agent/scope';
import type { ConversationScope } from '../../../src/lib/agent/types';

const PROJECT = 'project-1';
const FOLDER = 'folder-1';
const LIBRARY = 'library-1';

describe('resolveScopeFromNavigation', () => {
  it('freezes the originating workspace into the conversation scope', () => {
    const scope = resolveScopeFromNavigation({
      projectId: PROJECT,
      workspace: 'script',
    });
    expect(scope).toEqual({
      level: 'project',
      projectId: PROJECT,
      workspace: 'script',
    });
    expect(contextFieldsFromScope(scope, 'fallback').workspace).toBe('script');
  });

  it('resolves table level when a library is selected', () => {
    const scope = resolveScopeFromNavigation({
      projectId: PROJECT,
      currentFolderId: FOLDER,
      currentFolderName: 'Worldview',
      currentLibraryId: LIBRARY,
      currentLibraryName: 'Characters',
    });
    expect(scope).toEqual({
      level: 'table',
      projectId: PROJECT,
      folderId: FOLDER,
      folderName: 'Worldview',
      libraryId: LIBRARY,
      libraryName: 'Characters',
    });
  });

  it('resolves folder level when a folder but no library is selected', () => {
    const scope = resolveScopeFromNavigation({
      projectId: PROJECT,
      currentFolderId: FOLDER,
      currentFolderName: 'Worldview',
    });
    expect(scope).toEqual({
      level: 'folder',
      projectId: PROJECT,
      folderId: FOLDER,
      folderName: 'Worldview',
    });
  });

  it('resolves project level when only a project is selected', () => {
    expect(resolveScopeFromNavigation({ projectId: PROJECT })).toEqual({
      level: 'project',
      projectId: PROJECT,
    });
  });

  it('resolves global level when nothing is selected', () => {
    expect(resolveScopeFromNavigation({})).toEqual({ level: 'global' });
  });

  it('prefers table over folder when both a folder and library are present', () => {
    const scope = resolveScopeFromNavigation({
      projectId: PROJECT,
      currentFolderId: FOLDER,
      currentLibraryId: LIBRARY,
    });
    expect(scope.level).toBe('table');
    expect(scope.libraryId).toBe(LIBRARY);
  });
});

describe('contextFieldsFromScope', () => {
  it('degrades legacy (no scope) to the fallback project id', () => {
    expect(contextFieldsFromScope(undefined, PROJECT)).toEqual({ projectId: PROJECT });
  });

  it('maps a table scope to full navigation fields', () => {
    const scope: ConversationScope = {
      level: 'table',
      projectId: PROJECT,
      folderId: FOLDER,
      folderName: 'Worldview',
      libraryId: LIBRARY,
      libraryName: 'Characters',
    };
    expect(contextFieldsFromScope(scope, 'fallback')).toEqual({
      projectId: PROJECT,
      currentFolderId: FOLDER,
      currentFolderName: 'Worldview',
      currentLibraryId: LIBRARY,
      currentLibraryName: 'Characters',
    });
  });

  it('maps a folder scope with empty library fields', () => {
    const scope: ConversationScope = {
      level: 'folder',
      projectId: PROJECT,
      folderId: FOLDER,
      folderName: 'Worldview',
    };
    expect(contextFieldsFromScope(scope, 'fallback')).toEqual({
      projectId: PROJECT,
      currentFolderId: FOLDER,
      currentFolderName: 'Worldview',
      currentLibraryId: undefined,
      currentLibraryName: undefined,
    });
  });

  it('falls back to the conversation project id when scope.projectId is missing', () => {
    const scope: ConversationScope = { level: 'global' };
    expect(contextFieldsFromScope(scope, PROJECT).projectId).toBe(PROJECT);
  });
});
