import { describe, expect, it } from '@jest/globals';
import { filterSelectableDocuments } from '@/components/script-system/SelectDocumentModal';

jest.mock('@/components/layout/hooks/useSidebarDocuments', () => ({
  useSidebarDocuments: () => ({ documents: [], isLoading: false }),
}));

const documents = [
  { id: 'doc-a', name: 'Opening Scene', folder_id: 'folder-a' },
  { id: 'doc-b', name: 'Ending Scene', folder_id: 'folder-b' },
  { id: 'doc-root', name: 'Root Notes', folder_id: null },
];

describe('filterSelectableDocuments', () => {
  it('limits a Folder import to documents already in that shared Folder', () => {
    expect(
      filterSelectableDocuments(documents, { query: '', folderId: 'folder-a' }).map(
        (document) => document.id,
      ),
    ).toEqual(['doc-a']);
  });

  it('keeps the original all-document import behavior at the Libraries root', () => {
    expect(
      filterSelectableDocuments(documents, { query: 'scene' }).map(
        (document) => document.id,
      ),
    ).toEqual(['doc-a', 'doc-b']);
  });
});
