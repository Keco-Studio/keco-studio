/** @jest-environment jsdom */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

import { KecoAdminDashboard } from '@/components/keco-admin/KecoAdminDashboard';

type FetchResult = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function response(status: number, body: unknown): FetchResult {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <KecoAdminDashboard />
    </QueryClientProvider>,
  );
}

describe('Keco Admin dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the real total and complete unavailable resource UI', async () => {
    global.fetch = jest.fn(async () => response(200, {
      totalUsers: 9,
      refreshedAt: '2026-09-11T10:00:00.000Z',
    })) as never;

    renderDashboard();

    expect((await screen.findByTestId('keco-admin-total-users')).textContent).toContain('9');
    expect(screen.getByRole('heading', { name: 'Keco Admin' })).toBeTruthy();
    expect(screen.getByText('Admin only')).toBeTruthy();
    expect(screen.getAllByText('Not connected')).toHaveLength(3);
    expect(
      screen.getByRole('table', { name: 'User resource details' }),
    ).toBeTruthy();
    expect(screen.getByText('User detail data is not connected')).toBeTruthy();
    expect(screen.queryByText('2779398949@qq.com')).toBeNull();
  });

  it('shows stable loading UI without a false total', () => {
    global.fetch = jest.fn(() => new Promise(() => undefined)) as never;

    renderDashboard();

    expect(screen.getByTestId('keco-admin-total-loading')).toBeTruthy();
    expect(screen.queryByTestId('keco-admin-total-users')).toBeNull();
  });

  it('shows a first-load error and retries on command', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(503, { error: 'Unavailable' }))
      .mockResolvedValueOnce(response(200, {
        totalUsers: 9,
        refreshedAt: '2026-09-11T10:00:00.000Z',
      })) as never;

    renderDashboard();

    expect(await screen.findByText('Admin data could not be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect((await screen.findByTestId('keco-admin-total-users')).textContent).toContain('9');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last count visible when a manual refresh fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(200, {
        totalUsers: 9,
        refreshedAt: '2026-09-11T10:00:00.000Z',
      }))
      .mockResolvedValueOnce(response(503, { error: 'Unavailable' })) as never;

    renderDashboard();
    expect((await screen.findByTestId('keco-admin-total-users')).textContent).toContain('9');

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh admin data' }),
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Refresh failed. Showing the last synced total.')).toBeTruthy();
    expect(screen.getByTestId('keco-admin-total-users').textContent).toContain('9');
  });

  it.each([401, 403])('returns unauthorized users to projects on %i', async (status) => {
    global.fetch = jest.fn(async () => response(status, { error: 'Denied' })) as never;

    renderDashboard();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/projects'));
  });
});
