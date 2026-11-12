import { describe, expect, it } from '@jest/globals';
import {
  normalizeScriptDocumentEdge,
  wouldCreateScriptDocumentCycle,
} from '@/lib/script-system/scriptDocumentEdgeService';

describe('script document edge service', () => {
  it('normalizes optional branch names to null', () => {
    expect(normalizeScriptDocumentEdge({
      projectId: 'project-1',
      folderId: 'folder-1',
      parentDocumentId: 'doc-a',
      childDocumentId: 'doc-b',
      branchName: '   ',
    })).toMatchObject({
      project_id: 'project-1',
      folder_id: 'folder-1',
      parent_document_id: 'doc-a',
      child_document_id: 'doc-b',
      branch_name: null,
    });
  });

  it('detects whether a new edge would create a cycle', () => {
    const edges = [
      { parent_document_id: 'doc-a', child_document_id: 'doc-b' },
      { parent_document_id: 'doc-b', child_document_id: 'doc-c' },
    ];
    expect(wouldCreateScriptDocumentCycle(edges, 'doc-c', 'doc-a')).toBe(true);
    expect(wouldCreateScriptDocumentCycle(edges, 'doc-a', 'doc-c')).toBe(false);
  });
});
