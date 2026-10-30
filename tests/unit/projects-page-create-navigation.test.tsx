/** @jest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockRouter = { push: jest.fn() };
const mockInvalidateQueries = jest.fn(() => new Promise<never>(() => {}));
const mockSetQueryData = jest.fn();
const mockPatchProjectFoundationCaches = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));
jest.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { id: 'user-1' } }),
}));
jest.mock('@/lib/contexts/NavigationContext', () => ({
  useNavigation: () => ({ setShowCreateProjectBreadcrumb: jest.fn() }),
}));
jest.mock('@/lib/services/projectService', () => ({ listProjects: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, error: null }),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
  }),
}));
jest.mock('@/lib/queryInvalidation', () => ({
  patchProjectFoundationCaches: mockPatchProjectFoundationCaches,
}));
jest.mock('@/assets/images/projectEmptyIcon_2.png', () => '/project-empty.png');
jest.mock('@/assets/images/plusHorizontal.svg', () => '/plus-horizontal.svg');
jest.mock('@/assets/images/plusVertical.svg', () => '/plus-vertical.svg');
jest.mock('@/components/projects/NewProjectModal', () => ({
  NewProjectModal: ({ onCreated }: { onCreated: (payload: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onCreated({
        project: {
          id: 'project-new',
          owner_id: 'user-1',
          name: 'New project',
          description: 'Foundation description',
          genres: ['RPG'],
          design_philosophies: ['Player Agency'],
          created_at: '2026-10-30T10:00:00.000Z',
          updated_at: '2026-10-30T10:00:00.000Z',
        },
        defaultFolderId: 'folder-default',
      })}
    >
      Complete project creation
    </button>
  ),
}));

const ProjectsPage = require('@/app/(dashboard)/projects/page').default;

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it('navigates to a created project while project-cache refreshes are still pending', () => {
  render(<ProjectsPage />);

  fireEvent.click(screen.getByRole('button', { name: 'Complete project creation' }));

  expect(mockPatchProjectFoundationCaches).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    id: 'project-new',
    name: 'New project',
    genres: ['RPG'],
    design_philosophies: ['Player Agency'],
  }));
  expect(mockSetQueryData).toHaveBeenCalledWith(
    ['project', 'project-new', 'folders'],
    [{
      id: 'folder-default',
      project_id: 'project-new',
      parent_folder_id: null,
      name: 'Resources Folder',
      description: 'Default resources folder',
      created_at: '2026-10-30T10:00:00.000Z',
      updated_at: '2026-10-30T10:00:00.000Z',
      updated_by: 'user-1',
    }],
  );
  expect(mockRouter.push).toHaveBeenCalledWith('/project-new/recent');
  expect(mockInvalidateQueries).toHaveBeenCalledWith({
    queryKey: ['project', 'project-new', 'folders'],
  });
  expect(mockInvalidateQueries).toHaveBeenCalledWith({
    queryKey: ['folders-libraries', 'project-new'],
  });
});
