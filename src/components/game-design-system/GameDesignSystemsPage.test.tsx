/** @jest-environment jsdom */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextEncoder } from 'util';
import { GameDesignSystemsPage } from './GameDesignSystemsPage';
import { gameDesignSystemScopeCounts, visibleGameDesignSystems } from './GameDesignSystemLibrary';
import type { GameDesignSystem } from '@/lib/services/gameDesignSystemService';

global.TextEncoder = TextEncoder as typeof global.TextEncoder;

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
}));

const updateMetadata = jest.fn();
const applyVersion = jest.fn();
const clearBinding = jest.fn();
const createVersion = jest.fn();
const fetchSystems = jest.fn();
const fetchDetail = jest.fn();
const fetchBinding = jest.fn();
const startGdd = jest.fn();
const fetchGddJob = jest.fn();
const push = jest.fn();
const system: GameDesignSystem = {
  id: 'system-1', owner_id: 'user-1', source: 'user', title: 'Tactical Rules', summary: 'Old summary',
  genres: ['Strategy'], philosophies: ['Readable Systems'], suitable_for: 'Tactical games', body: '', provenance: {}, status: 'draft',
  current_version_id: 'version-1', migration_status: 'ready', generation_job_id: null, created_at: '', updated_at: '',
};
const designDocument = {
  designIntent: 'Make every tactical choice legible before commitment.',
  playerFantasy: 'Lead a compact squad through risky, recoverable decisions.',
  coreLoop: 'Scout, commit, resolve consequences, then adapt the squad plan.',
  decisionStructure: 'Trade immediate safety for positional advantage.',
  systemBoundaries: 'Uncertainty may hide outcomes but never action costs.',
  progressionEconomy: 'New tools widen options without invalidating old ones.',
  contentModel: 'Combine objectives, terrain pressure, and enemy roles.',
  difficultyBalance: 'Increase decision pressure instead of inflating stats.',
  experiencePresentation: 'Show intent, costs, and state changes at the point of action.',
};
const version = {
  id: 'version-1', system_id: 'system-1', version_number: 1, parent_version_id: null,
  document: designDocument,
  rules: { schemaVersion: 1, genres: ['Strategy'], philosophies: ['Readable Systems'], suitableFor: 'Tactical games', rules: [{ id: 'readable-state', kind: 'principle', title: 'Readable state', statement: 'Show inputs.', appliesWhen: 'Choosing.', severity: 'required' }], tableGuidance: [] },
  rendered_markdown: '# Tactical Rules', source_snapshots: [], diff: { added: ['readable-state'], removed: [], changed: [], conflicts: [] }, conflicts: [], content_hash: 'a'.repeat(64), created_by: 'user-1', created_at: '',
};

jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { id: 'user-1' } }),
}));
jest.mock('./GameDesignSystemsPage.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.mock('@/lib/services/gameDesignSystemClient', () => ({
  fetchGameDesignSystems: (...args: unknown[]) => fetchSystems(...args),
  fetchGameDesignSystem: (...args: unknown[]) => fetchDetail(...args),
  updateGameDesignSystemDraft: (...args: unknown[]) => updateMetadata(...args),
  createGameDesignSystemVersion: (...args: unknown[]) => createVersion(...args),
  copyGameDesignSystemDraft: jest.fn(),
  deleteGameDesignSystem: jest.fn(),
  applyProjectGameDesignSystem: (...args: unknown[]) => applyVersion(...args),
  clearProjectGameDesignSystem: (...args: unknown[]) => clearBinding(...args),
  fetchProjectGameDesignSystem: (...args: unknown[]) => fetchBinding(...args),
  startProjectGddGeneration: (...args: unknown[]) => startGdd(...args),
  fetchProjectGddGenerationJob: (...args: unknown[]) => fetchGddJob(...args),
}));

describe('GameDesignSystemsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] })) as jest.Mock;
    updateMetadata.mockResolvedValue({ ...system, summary: 'New summary' });
    applyVersion.mockResolvedValue(null);
    clearBinding.mockResolvedValue(undefined);
    createVersion.mockResolvedValue({ ...version, id: 'version-2', version_number: 2, parent_version_id: 'version-1' });
    fetchBinding.mockResolvedValue(null);
    startGdd.mockResolvedValue({
      id: 'gdd-job-1', project_id: 'project-1', status: 'completed', phase: 'completed',
      output_document_id: 'document-1', output_document_name: 'Game Design Document - Draft',
    });
    fetchGddJob.mockResolvedValue(null);
    fetchSystems.mockResolvedValue([system]);
    fetchDetail.mockResolvedValue({ ...system, current_version: version, versions: [version] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps Official visible as a real empty library state', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByText('Tactical Rules');
    await user.click(screen.getByRole('tab', { name: /Official/ }));

    expect(screen.getByText('No official systems yet.')).toBeTruthy();
    expect(screen.queryByText('Tactical Rules')).toBeNull();
  });

  it('classifies readable foreign user systems as Shared with an independent count', () => {
    const foreign = { ...system, id: 'foreign-system', owner_id: 'user-2', title: 'Shared Rules' };
    const official = { ...system, id: 'official-system', owner_id: null, source: 'official' as const };
    const systems = [system, foreign, official];

    expect(gameDesignSystemScopeCounts(systems, 'user-1')).toEqual({ mine: 1, shared: 1, official: 1 });
    expect(visibleGameDesignSystems(systems, 'shared', 'user-1', '')).toEqual([foreign]);
  });

  it('shows readable foreign user systems in the Shared tab', async () => {
    const foreign = { ...system, id: 'foreign-system', owner_id: 'user-2', title: 'Shared Tactical Rules' };
    fetchSystems.mockResolvedValue([system, foreign]);
    fetchDetail.mockImplementation(async (id: string) => ({
      ...(id === foreign.id ? foreign : system), current_version: version, versions: [version],
    }));
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByText('Tactical Rules');
    await user.click(screen.getByRole('tab', { name: 'Shared 1' }));

    expect((await screen.findAllByText('Shared Tactical Rules')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Tactical Rules')).toBeNull();
  });

  it('keeps official presets read-only', async () => {
    const user = userEvent.setup();
    const official = {
      ...system,
      id: 'official-system',
      owner_id: null,
      source: 'official',
      title: 'Official Tactical Rules',
    };
    const officialVersion = { ...version, system_id: official.id };
    fetchSystems.mockResolvedValue([official]);
    fetchDetail.mockResolvedValue({
      ...official,
      current_version: officialVersion,
      versions: [officialVersion],
    });

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    await user.click(await screen.findByRole('tab', { name: /Official/ }));
    expect(await screen.findByRole('heading', { name: 'Design document' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy and edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete system' })).toBeNull();
  });

  it('switches selected-system views without routing', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    expect(await screen.findByRole('heading', { name: 'Design document' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(designDocument.designIntent)).toBeTruthy();
    expect(screen.queryByText(JSON.stringify(designDocument))).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Rules' }));

    expect(screen.getByText('readable-state')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('renders every selected-system view from loaded data', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ id: 'project-1', name: 'Project A' }] })) as jest.Mock;
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Versions' }));
    expect(screen.getByRole('heading', { name: 'Version 1' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Sources' }));
    expect(screen.getByText('No source snapshots for this version.')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    expect((await screen.findAllByText('Project A')).length).toBeGreaterThan(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('opens creation in the workspace without routing', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('button', { name: 'Create Game Design System' }));
    expect(screen.getByRole('heading', { name: 'Create Game Design System' })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('creates a version only after reviewing a structured rule draft', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Rules' }));
    await user.click(screen.getByRole('button', { name: 'New version' }));
    await user.click(screen.getByRole('button', { name: 'Readable state' }));
    const statement = screen.getByLabelText('Rule statement');
    await user.clear(statement);
    await user.type(statement, 'Show all decision inputs.');
    expect(createVersion).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('button', { name: 'Create version' }));
    await waitFor(() => expect(createVersion).toHaveBeenCalledWith(
      'system-1',
      expect.objectContaining({ rules: expect.arrayContaining([expect.objectContaining({ statement: 'Show all decision inputs.' })]) }),
      'version-1',
    ));
  });

  it('creates a new immutable version after reviewing document edits', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Rules' }));
    await user.click(screen.getByRole('button', { name: 'Edit document' }));
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Copy and edit' })).toBeNull();
    const intent = screen.getByLabelText('Design intent');
    await user.clear(intent);
    await user.type(intent, 'Make every consequence readable.');
    expect(createVersion).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Review document' }));
    expect(screen.getByText('Make every consequence readable.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create version' }));

    await waitFor(() => expect(createVersion).toHaveBeenCalledWith(
      'system-1',
      version.rules,
      'version-1',
      expect.objectContaining({ designIntent: 'Make every consequence readable.' }),
    ));
  });

  it('keeps a dirty document draft when navigation is not confirmed', async () => {
    const confirm = jest.fn(() => false);
    window.confirm = confirm;
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('button', { name: 'Edit document' }));
    const intent = screen.getByLabelText('Design intent');
    await user.clear(intent);
    await user.type(intent, 'Keep this unsaved draft.');
    await user.click(screen.getByRole('tab', { name: 'Rules' }));

    expect(confirm).toHaveBeenCalledWith('Discard unsaved Game Design System changes?');
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Design intent') as HTMLTextAreaElement).value).toBe('Keep this unsaved draft.');
  });

  it('keeps the current scope and draft when a dirty scope change is rejected', async () => {
    const confirm = jest.fn(() => false);
    window.confirm = confirm;
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('button', { name: 'Edit document' }));
    await user.type(screen.getByLabelText('Design intent'), ' Unsaved.');
    await user.click(screen.getByRole('tab', { name: /Official/ }));

    expect(confirm).toHaveBeenCalledWith('Discard unsaved Game Design System changes?');
    expect(screen.getByRole('tab', { name: /My Systems/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Design intent')).toBeTruthy();
  });

  it('resets metadata after a confirmed discard', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const summary = screen.getByLabelText('System summary');
    await user.clear(summary);
    await user.type(summary, 'Discarded summary');
    await user.click(screen.getByRole('button', { name: 'Cancel editing details' }));
    await user.click(screen.getByRole('button', { name: 'Edit details' }));

    expect((screen.getByLabelText('System summary') as HTMLTextAreaElement).value).toBe('Old summary');
  });

  it('renders structured version rules and edits metadata rather than Markdown body', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Design document' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Rules' }));
    expect(await screen.findByText('readable-state')).toBeTruthy();
    expect(screen.getByRole('option', { name: /Version 1/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const summary = screen.getByLabelText('System summary');
    await user.clear(summary);
    await user.type(summary, 'New summary');
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(updateMetadata).toHaveBeenCalledWith('system-1', expect.objectContaining({ summary: 'New summary' })));
    expect(screen.queryByLabelText('Edit GAME_DESIGN_SYSTEM.md')).toBeNull();
  });

  it('binds the explicitly selected version to a project', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ id: 'project-1', name: 'Project A' }] })) as jest.Mock;
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    await screen.findByRole('option', { name: 'Project A' });
    await user.selectOptions(screen.getByLabelText('Select project'), 'project-1');
    await user.click(screen.getByRole('button', { name: 'Use version 1' }));
    await waitFor(() => expect(applyVersion).toHaveBeenCalledWith('project-1', 'system-1', 'version-1'));
  });

  it('generates a GDD draft from the exact version already pinned to a project', async () => {
    global.fetch = jest.fn(async (url: string) => {
      expect(url).toBe('/api/projects/writable');
      return { ok: true, json: async () => [{ id: 'project-1', name: 'Project A' }] };
    }) as jest.Mock;
    fetchBinding.mockResolvedValue({ ...system, current_version: version, versions: [version] });
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: 'Generate GDD Draft' }));

    await waitFor(() => expect(startGdd).toHaveBeenCalledWith('project-1', 'system-1', 'version-1'));
    expect((await screen.findByRole('link', { name: 'Open GDD Document' })).getAttribute('href')).toBe('/project-1/doc/document-1');
  });

  it('polls queued and running jobs until completed', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ id: 'project-1', name: 'Project A' }] })) as jest.Mock;
    fetchBinding.mockResolvedValue({ ...system, current_version: version, versions: [version] });
    startGdd.mockResolvedValue({
      id: 'gdd-job-1', project_id: 'project-1', status: 'queued', phase: 'collecting',
      output_document_id: null, output_document_name: null,
    });
    fetchGddJob
      .mockResolvedValueOnce({ id: 'gdd-job-1', project_id: 'project-1', status: 'running', phase: 'generating', output_document_id: null })
      .mockResolvedValueOnce({ id: 'gdd-job-1', project_id: 'project-1', status: 'completed', phase: 'completed', output_document_id: 'document-1' });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: 'Generate GDD Draft' }));
    expect((screen.getByRole('button', { name: 'Generating GDD...' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { jest.advanceTimersByTime(900); await Promise.resolve(); });
    expect(await screen.findByText(/GDD: generating/)).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(900); await Promise.resolve(); });
    expect(await screen.findByRole('link', { name: 'Open GDD Document' })).toBeTruthy();
    jest.useRealTimers();
  });

  it('stops polling and exposes retry after a failed job', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ id: 'project-1', name: 'Project A' }] })) as jest.Mock;
    fetchBinding.mockResolvedValue({ ...system, current_version: version, versions: [version] });
    startGdd.mockResolvedValue({ id: 'gdd-job-1', project_id: 'project-1', status: 'queued', phase: 'collecting', output_document_id: null });
    fetchGddJob.mockResolvedValue({ id: 'gdd-job-1', project_id: 'project-1', status: 'failed', phase: 'failed', output_document_id: null, error: 'Permission changed.' });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: 'Generate GDD Draft' }));
    await act(async () => { jest.advanceTimersByTime(900); await Promise.resolve(); });

    expect(await screen.findByRole('button', { name: 'Retry GDD Draft' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Permission changed.');
    const callsAfterFailure = fetchGddJob.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(1_800); await Promise.resolve(); });
    expect(fetchGddJob).toHaveBeenCalledTimes(callsAfterFailure);
    jest.useRealTimers();
  });

  it('does not classify another user\'s readable system as mine', async () => {
    fetchSystems.mockResolvedValue([{ ...system, id: 'foreign-system', owner_id: 'user-2', title: 'Foreign Rules' }]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    expect(await screen.findByText('No personal systems yet.')).toBeTruthy();
    expect(screen.queryByText('Foreign Rules')).toBeNull();
  });

  it('shows the parent version, changed IDs, and conflict reasons', async () => {
    const parent = { ...version, id: 'version-1', version_number: 1 };
    const current = {
      ...version,
      id: 'version-2',
      version_number: 2,
      parent_version_id: 'version-1',
      diff: { added: ['visible-costs'], removed: [], changed: ['readable-state'], conflicts: [{ ruleId: 'readable-state', reason: 'Rule kind changed from principle to constraint.' }] },
      conflicts: [{ ruleId: 'readable-state', reason: 'Rule kind changed from principle to constraint.' }],
    };
    fetchDetail.mockResolvedValue({ ...system, current_version_id: 'version-2', current_version: current, versions: [current, parent] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'Design document' });
    await userEvent.click(screen.getByRole('tab', { name: 'Rules' }));
    expect(await screen.findByText('Based on version 1')).toBeTruthy();
    expect(screen.getByText('Changed: readable-state')).toBeTruthy();
    expect(screen.getByText('readable-state: Rule kind changed from principle to constraint.')).toBeTruthy();
  });
});
