/** @jest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { checkProjectNameExists, createProject, type Project } from '@/lib/services/projectService';
import { NewProjectModal } from './NewProjectModal';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({ client: 'supabase' }) }));
jest.mock('@/lib/services/projectService', () => ({
  checkProjectNameExists: jest.fn(),
  createProject: jest.fn(),
}));

const createdProject: Project = {
  id: 'project-1',
  owner_id: 'user-1',
  name: 'Harbor Signal',
  description: 'A cooperative mystery.',
  genres: ['RPG'],
  design_philosophies: ['Player Agency'],
  created_at: '2026-10-30T10:00:00.000Z',
  updated_at: '2026-10-30T10:00:00.000Z',
};

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
  jest.mocked(checkProjectNameExists).mockResolvedValue(false);
  jest.mocked(createProject).mockResolvedValue({
    project: createdProject,
    defaultFolderId: 'folder-1',
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

async function enterFoundationDraft() {
  await user.type(screen.getByLabelText('Project name'), 'Harbor Signal');
  await user.type(screen.getByLabelText('Description'), 'A cooperative mystery.');
  await user.click(screen.getByRole('button', { name: 'RPG' }));
  await user.click(screen.getByRole('button', { name: 'Player Agency' }));
}

it('creates a project with all Foundation fields and returns the service payload', async () => {
  const onCreated = jest.fn();
  render(<NewProjectModal open onClose={jest.fn()} onCreated={onCreated} />);

  await enterFoundationDraft();
  await user.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() => {
    expect(createProject).toHaveBeenCalledWith(expect.anything(), {
      name: 'Harbor Signal',
      description: 'A cooperative mystery.',
      genres: ['RPG'],
      designPhilosophies: ['Player Agency'],
    });
  });
  expect(onCreated).toHaveBeenCalledWith({
    project: createdProject,
    defaultFolderId: 'folder-1',
  });
});

it('keeps the dialog and complete Foundation draft after creation fails', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.mocked(createProject).mockRejectedValueOnce(new Error('Creation failed'));
  render(<NewProjectModal open onClose={jest.fn()} onCreated={jest.fn()} />);

  await enterFoundationDraft();
  await user.click(screen.getByRole('button', { name: 'Create' }));

  expect((await screen.findByRole('alert')).textContent).toContain('Creation failed');
  expect(screen.getByRole('dialog')).not.toBeNull();
  expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Harbor Signal');
  expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('A cooperative mystery.');
  expect(screen.getByRole('button', { name: 'RPG' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Player Agency' }).getAttribute('aria-pressed')).toBe('true');
  consoleError.mockRestore();
});

it('does not impose character limits on project Foundation fields', () => {
  render(<NewProjectModal open onClose={jest.fn()} onCreated={jest.fn()} />);

  expect(screen.getByLabelText('Project name').getAttribute('maxlength')).toBeNull();
  expect(screen.getByLabelText('Description').getAttribute('maxlength')).toBeNull();
  expect(screen.getByLabelText('Game genres').getAttribute('maxlength')).toBeNull();
  expect(screen.getByLabelText('Design philosophies').getAttribute('maxlength')).toBeNull();
});
