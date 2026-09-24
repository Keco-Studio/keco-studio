/** @jest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockRouter = { push: jest.fn() };
const mockInvalidateQueries = jest.fn(() => new Promise<never>(() => {}));
const mockUpsertProjectInListCache = jest.fn();

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
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));
jest.mock('@/lib/queryInvalidation', () => ({ upsertProjectInListCache: mockUpsertProjectInListCache }));
jest.mock('@/assets/images/projectEmptyIcon_2.png', () => '/project-empty.png');
jest.mock('@/assets/images/plusHorizontal.svg', () => '/plus-horizontal.svg');
jest.mock('@/assets/images/plusVertical.svg', () => '/plus-vertical.svg');
jest.mock('@/components/projects/NewProjectModal', () => ({
  NewProjectModal: ({ onCreated }: { onCreated: (payload: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onCreated({
        projectId: 'project-new',
        defaultFolderId: 'folder-default',
        name: 'New project',
        description: null,
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

  expect(mockUpsertProjectInListCache).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    id: 'project-new',
    name: 'New project',
  }));
  expect(mockRouter.push).toHaveBeenCalledWith('/project-new/recent');
  expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
});
