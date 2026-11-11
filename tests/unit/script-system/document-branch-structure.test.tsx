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
          { id: 'doc-a', name: '开场' },
          { id: 'doc-b', name: '森林' },
        ]}
        edges={[{
          id: 'edge-1',
          parent_document_id: 'doc-a',
          child_document_id: 'doc-b',
          branch_name: '选择离开',
        }]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Document Branch Structure' })).toBeTruthy();
    expect(screen.getByText('开场')).toBeTruthy();
    expect(screen.getByText('森林')).toBeTruthy();
    expect(screen.getByText('选择离开')).toBeTruthy();
  });
});
