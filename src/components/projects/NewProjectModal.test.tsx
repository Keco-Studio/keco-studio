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

async function enterIdentityDraft() {
  await user.type(screen.getByLabelText('Project name'), 'Harbor Signal');
  await user.type(screen.getByLabelText('Description'), 'A cooperative mystery.');
}

it('places project details before template selection', () => {
  render(<NewProjectModal open onClose={jest.fn()} onCreated={jest.fn()} />);

  const sectionHeadings = screen.getAllByRole('heading', { level: 3 });
  expect(sectionHeadings.map((heading) => heading.textContent)).toEqual([
    'Project details',
    'Start from a template',
  ]);
});

it('creates a project with identity fields only and returns the service payload', async () => {
  const onCreated = jest.fn();
  render(<NewProjectModal open onClose={jest.fn()} onCreated={onCreated} />);

  expect(screen.getByRole('button', { name: /Blank project/ }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByLabelText('Game genres')).toBeNull();
  expect(screen.queryByLabelText('Design philosophies')).toBeNull();
  await enterIdentityDraft();
  await user.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() => {
    expect(createProject).toHaveBeenCalledWith(expect.anything(), {
      name: 'Harbor Signal',
      description: 'A cooperative mystery.',
      templateKey: 'blank',
      templateRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
  });
  expect(onCreated).toHaveBeenCalledWith({
    project: createdProject,
    defaultFolderId: 'folder-1',
  });
});

it('keeps the selected template, identity draft, and request ID across a retry', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.mocked(createProject).mockRejectedValueOnce(new Error('Creation failed'));
  render(<NewProjectModal open onClose={jest.fn()} onCreated={jest.fn()} />);

  await user.click(screen.getByRole('button', { name: /Tactical deckbuilder/ }));
  await enterIdentityDraft();
  await user.click(screen.getByRole('button', { name: 'Create' }));

  expect((await screen.findByRole('alert')).textContent).toContain('Creation failed');
  expect(screen.getByRole('dialog')).not.toBeNull();
  expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Harbor Signal');
  expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('A cooperative mystery.');
  expect(screen.getByRole('button', { name: /Tactical deckbuilder/ }).getAttribute('aria-pressed')).toBe('true');

  const firstRequestId = jest.mocked(createProject).mock.calls[0][1].templateRequestId;
  jest.mocked(createProject).mockResolvedValueOnce({ project: createdProject, defaultFolderId: 'folder-1' });
  await user.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(createProject).toHaveBeenCalledTimes(2));
  expect(jest.mocked(createProject).mock.calls[1][1].templateRequestId).toBe(firstRequestId);
  consoleError.mockRestore();
});

it('resets the selected template after successful creation', async () => {
  const onClose = jest.fn();
  const view = render(<NewProjectModal open onClose={onClose} onCreated={jest.fn()} />);

  await user.click(screen.getByRole('button', { name: /Tactical deckbuilder/ }));
  await enterIdentityDraft();
  await user.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());

  view.rerender(<NewProjectModal open={false} onClose={onClose} onCreated={jest.fn()} />);
  view.rerender(<NewProjectModal open onClose={onClose} onCreated={jest.fn()} />);
  expect(screen.getByRole('button', { name: /Blank project/ }).getAttribute('aria-pressed')).toBe('true');
});

it('does not impose character limits on project identity fields', () => {
  render(<NewProjectModal open onClose={jest.fn()} onCreated={jest.fn()} />);

  expect(screen.getByLabelText('Project name').getAttribute('maxlength')).toBeNull();
  expect(screen.getByLabelText('Description').getAttribute('maxlength')).toBeNull();
});
