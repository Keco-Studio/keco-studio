/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, jest } from '@jest/globals';
import { DocumentBranchStructure } from '@/components/script-system/DocumentBranchStructure';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

describe('DocumentBranchStructure', () => {
  it('renders document nodes and optional relationship labels', () => {
    render(
      <DocumentBranchStructure
        projectId="project-1"
        folderId="folder-1"
        folderName="Resources Folder"
        documents={[
          { id: 'doc-a', name: '\u5f00\u573a' },
          { id: 'doc-b', name: '\u68ee\u6797' },
        ]}
        edges={[{
          id: 'edge-1',
          parent_document_id: 'doc-a',
          child_document_id: 'doc-b',
          branch_name: '\u9009\u62e9\u79bb\u5f00',
        }]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Document Branch Structure' })).toBeTruthy();
    expect(screen.getByText('\u5f00\u573a')).toBeTruthy();
    expect(screen.getByText('\u68ee\u6797')).toBeTruthy();
    expect(screen.getByText('\u9009\u62e9\u79bb\u5f00')).toBeTruthy();
  });
});
