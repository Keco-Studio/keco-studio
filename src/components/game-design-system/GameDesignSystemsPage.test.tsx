/** @jest-environment jsdom */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameDesignSystemsPage } from './GameDesignSystemsPage';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
}));

const updateMetadata = jest.fn();
const applyVersion = jest.fn();
const fetchSystems = jest.fn();
const fetchDetail = jest.fn();
const system = {
  id: 'system-1', owner_id: 'user-1', source: 'user', title: 'Tactical Rules', summary: 'Old summary',
  genres: ['Strategy'], philosophies: ['Readable Systems'], suitable_for: 'Tactical games', body: '', provenance: {}, status: 'draft',
  current_version_id: 'version-1', migration_status: 'ready', generation_job_id: null, created_at: '', updated_at: '',
};
const version = {
  id: 'version-1', system_id: 'system-1', version_number: 1, parent_version_id: null,
  rules: { schemaVersion: 1, genres: ['Strategy'], philosophies: ['Readable Systems'], suitableFor: 'Tactical games', rules: [{ id: 'readable-state', kind: 'principle', title: 'Readable state', statement: 'Show inputs.', appliesWhen: 'Choosing.', severity: 'required' }], tableGuidance: [] },
  rendered_markdown: '# Tactical Rules', source_snapshots: [], diff: { added: ['readable-state'], removed: [], changed: [], conflicts: [] }, conflicts: [], content_hash: 'a'.repeat(64), created_by: 'user-1', created_at: '',
};

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
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
  createGameDesignSystemVersion: jest.fn(), copyGameDesignSystemDraft: jest.fn(), deleteGameDesignSystem: jest.fn(), applyProjectGameDesignSystem: (...args: unknown[]) => applyVersion(...args),
}));

describe('GameDesignSystemsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] })) as jest.Mock;
    updateMetadata.mockResolvedValue({ ...system, summary: 'New summary' });
    applyVersion.mockResolvedValue(null);
    fetchSystems.mockResolvedValue([system]);
    fetchDetail.mockResolvedValue({ ...system, current_version: version, versions: [version] });
  });

  it('renders structured version rules and edits metadata rather than Markdown body', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    expect(await screen.findByText('readable-state')).toBeTruthy();
    expect(screen.getByRole('option', { name: /版本 1/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '编辑信息' }));
    const summary = screen.getByLabelText('体系简介');
    await user.clear(summary);
    await user.type(summary, 'New summary');
    await user.click(screen.getByRole('button', { name: '保存信息' }));
    await waitFor(() => expect(updateMetadata).toHaveBeenCalledWith('system-1', expect.objectContaining({ summary: 'New summary' })));
    expect(screen.queryByLabelText('编辑 GAME_DESIGN_SYSTEM.md')).toBeNull();
  });

  it('binds the explicitly selected version to a project', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ id: 'project-1', name: 'Project A' }] })) as jest.Mock;
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    await screen.findByText('readable-state');
    await screen.findByRole('option', { name: 'Project A' });
    await user.selectOptions(screen.getByLabelText('选择项目'), 'project-1');
    await user.click(screen.getByRole('button', { name: '使用版本 1' }));
    await waitFor(() => expect(applyVersion).toHaveBeenCalledWith('project-1', 'system-1', 'version-1'));
  });

  it('does not classify another user\'s readable system as mine', async () => {
    fetchSystems.mockResolvedValue([{ ...system, id: 'foreign-system', owner_id: 'user-2', title: 'Foreign Rules' }]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    expect(await screen.findByText('当前没有匹配的体系。')).toBeTruthy();
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
    expect(await screen.findByText('基于版本 1')).toBeTruthy();
    expect(screen.getByText('修改: readable-state')).toBeTruthy();
    expect(screen.getByText('readable-state: Rule kind changed from principle to constraint.')).toBeTruthy();
  });
});
