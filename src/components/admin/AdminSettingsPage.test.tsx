/** @jest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';
import { updateProject, type Project } from '@/lib/services/projectService';
import { patchProjectFoundationCaches } from '@/lib/queryInvalidation';
import { AdminSettingsPage } from './AdminSettingsPage';

const setCurrentProjectName = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));
jest.mock('@/lib/hooks/useProjectRoleQuery', () => ({ useProjectRoleQuery: jest.fn() }));
jest.mock('@/lib/services/projectService', () => ({ updateProject: jest.fn() }));
jest.mock('@/lib/queryInvalidation', () => ({ patchProjectFoundationCaches: jest.fn() }));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({ client: 'supabase' }) }));
jest.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { id: 'user-1' } }),
}));
jest.mock('@/lib/contexts/NavigationContext', () => ({
  useNavigation: () => ({ setCurrentProjectName }),
}));
jest.mock('@/components/admin/AdminTabs', () => ({ AdminTabs: () => <nav>Settings tabs</nav> }));
jest.mock('@/lib/utils/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}));

const project: Project = {
  id: 'project-1',
  owner_id: 'user-1',
  name: 'Old name',
  description: 'Old description',
  genres: [],
  design_philosophies: [],
  created_at: '2026-10-30T10:00:00.000Z',
  updated_at: '2026-10-30T10:00:00.000Z',
};

const updatedProject: Project = {
  ...project,
  name: 'New name',
  description: 'New description',
  genres: ['Strategy'],
  design_philosophies: ['Readable Systems'],
  updated_at: '2026-10-30T11:00:00.000Z',
};

const refetch = jest.fn(async () => undefined);
const queryClient = { invalidateQueries: jest.fn() };
let user: ReturnType<typeof userEvent.setup>;

function renderSettings({ role, project: value }: { role: 'admin' | 'editor' | 'viewer'; project: Project }) {
  jest.mocked(useProjectRoleQuery).mockReturnValue({
    data: { role, isOwner: role === 'admin' },
    isLoading: false,
  } as ReturnType<typeof useProjectRoleQuery>);
  jest.mocked(useQuery).mockReturnValue({
    data: value,
    isLoading: false,
    refetch,
  } as never);
  return render(<AdminSettingsPage projectId="project-1" />);
}

beforeEach(() => {
  user = userEvent.setup();
  jest.mocked(useQueryClient).mockReturnValue(queryClient as never);
  jest.mocked(updateProject).mockResolvedValue(updatedProject);
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it('saves all four Foundation fields and refreshes project caches and breadcrumb', async () => {
  renderSettings({ role: 'admin', project });
  await user.clear(screen.getByLabelText('Project name'));
  await user.type(screen.getByLabelText('Project name'), 'New name');
  await user.clear(screen.getByLabelText('Description'));
  await user.type(screen.getByLabelText('Description'), 'New description');
  await user.click(screen.getByRole('button', { name: 'Strategy' }));
  await user.click(screen.getByRole('button', { name: 'Readable Systems' }));
  await user.click(screen.getByRole('button', { name: 'Save project information' }));

  await waitFor(() => {
    expect(updateProject).toHaveBeenCalledWith(expect.anything(), 'project-1', {
      name: 'New name',
      description: 'New description',
      genres: ['Strategy'],
      designPhilosophies: ['Readable Systems'],
      expectedUpdatedAt: project.updated_at,
    });
  });
  expect(patchProjectFoundationCaches).toHaveBeenCalledWith(expect.anything(), updatedProject);
  expect(setCurrentProjectName).toHaveBeenCalledWith('New name');
});

it('disables Save until the draft differs from persisted values', () => {
  renderSettings({ role: 'admin', project });
  expect((screen.getByRole('button', { name: 'Save project information' }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(['editor', 'viewer'] as const)('renders %s Foundation fields read-only', (role) => {
  renderSettings({ role, project });
  expect((screen.getByLabelText('Project name') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('Description') as HTMLTextAreaElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Save project information' })).toBeNull();
});

it('retains the draft and reports a failed save', async () => {
  jest.mocked(updateProject).mockRejectedValueOnce(new Error('Save failed'));
  renderSettings({ role: 'admin', project });
  await user.clear(screen.getByLabelText('Project name'));
  await user.type(screen.getByLabelText('Project name'), 'Unsaved name');
  await user.click(screen.getByRole('button', { name: 'Save project information' }));

  expect((await screen.findByRole('alert')).textContent).toContain('Save failed');
  expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Unsaved name');
});
