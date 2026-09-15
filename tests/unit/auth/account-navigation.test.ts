import { describe, expect, it } from '@jest/globals';
import {
  parseRouteParams,
  SPECIAL_ROUTE_SEGMENTS,
} from '@/lib/utils/routeParams';

describe('Account navigation', () => {
  it('treats /account as an account route without project context', () => {
    expect(SPECIAL_ROUTE_SEGMENTS).toContain('account');
    expect(parseRouteParams('/account')).toEqual({
      projectId: null,
      libraryId: null,
      folderId: null,
      assetId: null,
      documentId: null,
      isPredefinePage: false,
      isLibraryPage: false,
    });
  });
});
