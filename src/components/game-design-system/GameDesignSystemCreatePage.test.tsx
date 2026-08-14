/** @jest-environment jsdom */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameDesignSystemCreatePage } from './GameDesignSystemCreatePage';

const push = jest.fn();
const start = jest.fn();
const fetchOptions = jest.fn();
const retry = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('./GameDesignSystemsPage.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.mock('@/lib/services/gameDesignSystemClient', () => ({
  fetchGameDesignSystems: jest.fn(async () => []),
  fetchGameDesignReferenceOptions: (...args: unknown[]) => fetchOptions(...args),
  fetchGameDesignSystemGenerationJob: jest.fn(),
  retryGameDesignSystemGeneration: (...args: unknown[]) => retry(...args),
  startGameDesignSystemGeneration: (...args: unknown[]) => start(...args),
}));

describe('GameDesignSystemCreatePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Project A' }],
    })) as jest.Mock;
    fetchOptions.mockResolvedValue([
      { kind: 'document', projectId: '11111111-1111-4111-8111-111111111111', resourceId: '22222222-2222-4222-8222-222222222222', label: 'Combat GDD', updatedAt: '2026-08-14' },
      { kind: 'table', projectId: '11111111-1111-4111-8111-111111111111', resourceId: '33333333-3333-4333-8333-333333333333', label: 'Skills', updatedAt: '2026-08-14' },
    ]);
    start.mockResolvedValue({ id: 'job-1', status: 'queued', phase: 'collecting', attempt_count: 0, max_attempts: 3 });
    retry.mockResolvedValue({ id: 'job-1', status: 'queued', phase: 'collecting', attempt_count: 1, max_attempts: 3, available_at: new Date().toISOString() });
  });

  it('selects real project resources and submits their IDs', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemCreatePage /></QueryClientProvider>);
    await user.type(screen.getByLabelText('体系名称'), 'Tactical Rules');
    await user.click(screen.getByRole('button', { name: 'RPG' }));
    await screen.findByRole('option', { name: 'Project A' });
    await user.selectOptions(await screen.findByLabelText('来源项目'), '11111111-1111-4111-8111-111111111111');
    await user.click(await screen.findByRole('checkbox', { name: /Combat GDD/ }));
    await user.click(screen.getAllByRole('button', { name: /生成体系/ })[0]);
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Tactical Rules',
      references: [{ kind: 'document', projectId: '11111111-1111-4111-8111-111111111111', resourceId: '22222222-2222-4222-8222-222222222222' }],
    }), expect.any(String)));
  });

  it('retries a failed durable job without creating a replacement request', async () => {
    start.mockResolvedValueOnce({ id: 'job-1', status: 'failed', phase: 'failed', attempt_count: 1, max_attempts: 3, error: 'bad schema', available_at: new Date().toISOString() });
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemCreatePage /></QueryClientProvider>);
    await user.type(screen.getByLabelText('体系名称'), 'Retry Rules');
    await user.click(screen.getByRole('button', { name: 'RPG' }));
    await user.click(screen.getAllByRole('button', { name: /生成体系/ })[0]);
    await user.click(await screen.findByRole('button', { name: /重试任务/ }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith('job-1', expect.any(String)));
    expect(start).toHaveBeenCalledTimes(1);
  });
});
