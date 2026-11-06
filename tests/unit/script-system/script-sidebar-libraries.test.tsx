/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockPush = jest.fn();
let mockUserRole: 'admin' | 'editor' | 'viewer' = 'admin';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/script-system/project-1/doc/doc-folder',
}));

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => ({}),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt = '', ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} {...props} />
  ),
}));

jest.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { id: 'user-1' } }),
}));

jest.mock('@/components/layout/hooks/useSidebarProjects', () => ({
  useSidebarProjects: () => ({
    projects: [{ id: 'project-1', name: 'Adventure' }],
  }),
}));

jest.mock('@/components/layout/hooks/useSidebarProjectRole', () => ({
  useSidebarProjectRole: () => ({ userRole: mockUserRole }),
}));

jest.mock('@/components/layout/hooks/useSidebarFoldersLibraries', () => ({
  useSidebarFoldersLibraries: () => ({
    folders: [
      { id: 'folder-root', name: 'Resources Folder', parent_folder_id: null },
      { id: 'folder-nested', name: 'Chapter One', parent_folder_id: 'folder-root' },
    ],
    libraries: [],
    refetch: jest.fn(),
  }),
}));

jest.mock('@/components/script-system/useScriptWorkspaceMembership', () => ({
  useScriptWorkspaceMembership: () => ({
    documents: [
      { documentId: 'doc-root', importedAt: '2026-01-01', title: 'Overview', folderId: null },
      {
        documentId: 'doc-folder',
        importedAt: '2026-01-02',
        title: 'Opening Scene',
        folderId: 'folder-nested',
      },
    ],
    refetch: jest.fn(),
  }),
}));

jest.mock('@/components/script-system/useScriptSidebarActions', () => ({
  useScriptSidebarActions: () => ({
    handleAction: jest.fn(),
    commitRename: jest.fn(),
  }),
}));

import { ScriptSidebar } from '@/components/script-system/ScriptSidebar';

describe('ScriptSidebar Libraries tree', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUserRole = 'admin';
  });

  it('renders the shared folders as one level with only Script workspace documents', () => {
    const html = renderToStaticMarkup(<ScriptSidebar projectId="project-1" />);

    expect(html).toContain('Libraries');
    expect(html).toContain('Resources Folder');
    expect(html).toContain('Chapter One');
    expect(html).toContain('Overview');
    expect(html).toContain('Opening Scene');
    expect(html).toContain('title="Add folder, document, or import"');
    expect(html).not.toContain('<strong>Import</strong>');
  });

  it('opens the three root actions from the Libraries add button', () => {
    render(<ScriptSidebar projectId="project-1" />);

    const trigger = screen.getByTitle('Add folder, document, or import');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    expect(screen.getByRole('menu')).not.toBeNull();
    expect(screen.getByText('Create new folder')).not.toBeNull();
    expect(screen.getByText('Create new document')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Import' })).not.toBeNull();

    fireEvent.click(screen.getByText('Create new folder'));
    expect(screen.getByRole('dialog', { name: 'New Folder' })).not.toBeNull();
  });

  it('omits folder creation inside a Folder and carries that Folder into import', () => {
    render(<ScriptSidebar projectId="project-1" />);

    const trigger = screen.getByTitle('Add to Chapter One');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    expect(screen.queryByText('Create new folder')).toBeNull();
    expect(screen.getByText('Create new document')).not.toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import' }));
    expect(mockPush).toHaveBeenCalledWith(
      '/script-system/project-1?folderId=folder-nested',
    );
  });

  it('creates a document in a Folder without exposing nested Folder creation', () => {
    render(<ScriptSidebar projectId="project-1" />);

    fireEvent.click(screen.getByTitle('Add to Chapter One'));
    fireEvent.click(screen.getByText('Create new document'));

    expect(screen.getByRole('dialog', { name: 'Create Document' })).not.toBeNull();
    expect(screen.queryByText('Create new folder')).toBeNull();
  });

  it('labels viewer add triggers for their import-only action', () => {
    mockUserRole = 'viewer';
    render(<ScriptSidebar projectId="project-1" />);

    const rootTrigger = screen.getByTitle('Import');
    expect(rootTrigger).not.toBeNull();
    expect(screen.getByTitle('Import to Chapter One')).not.toBeNull();
    fireEvent.click(rootTrigger);
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Import' })).not.toBeNull();
  });
});
