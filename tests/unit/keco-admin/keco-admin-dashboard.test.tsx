/** @jest-environment jsdom */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

jest.mock('@/components/keco-admin/InviteAdminModal', () => ({
  InviteAdminModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Invite administrator" /> : null,
}));

import { KecoAdminDashboard } from '@/components/keco-admin/KecoAdminDashboard';

type FetchResult = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const sampleUsers = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'alice@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSignInAt: '2026-09-01T00:00:00.000Z',
    status: 'active' as const,
    creditAllocated: 100_000_000,
    creditUsed: 7,
    creditRemaining: 99_999_993,
    creditOverage: 0,
    deepseekTokens: 21,
    creditUsageIncompleteCount: 1,
    storageUsedBytes: 348_600_000_000,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'bob@example.com',
    createdAt: '2026-02-01T00:00:00.000Z',
    lastSignInAt: null,
    status: 'suspended' as const,
    creditAllocated: 5,
    creditUsed: 8,
    creditRemaining: 0,
    creditOverage: 3,
    deepseekTokens: 24,
    creditUsageIncompleteCount: 0,
    storageUsedBytes: 0,
  },
];

function overviewBody(overrides: Record<string, unknown> = {}) {
  return {
    totalUsers: 9,
    creditUsage: {
      allocated: 100_000_000,
      used: 7,
      remaining: 99_999_993,
      overage: 0,
      deepseekTokens: 21,
      incompleteCount: 1,
      trackedFrom: '2026-09-15T00:00:00.000Z',
    },
    storageUsage: { usedBytes: 549_755_813_888 },
    refreshedAt: '2026-09-11T10:00:00.000Z',
    users: sampleUsers,
    ...overrides,
  };
}

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

  it('renders live account, Credit, and Storage data', async () => {
    global.fetch = jest.fn(async () => response(200, overviewBody())) as never;

    renderDashboard();

    expect((await screen.findByTestId('keco-admin-total-users')).textContent).toContain('9');
    expect(screen.getByRole('heading', { name: 'Keco Admin' })).toBeTruthy();
    expect(screen.getByText('Admin only')).toBeTruthy();
    expect(screen.getByTestId('keco-admin-credit-used').textContent).toBe('7');
    expect(screen.getByTestId('keco-admin-credit-allocated').textContent).toBe('100,000,000');
    expect(screen.getByTestId('keco-admin-credit-remaining').textContent).toBe('99,999,993');
    expect(screen.getByTestId('keco-admin-storage-used').textContent).toBe('512 GB');
    expect(screen.queryByText('Stay duration')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Stay' })).toBeNull();
    expect(screen.getByText('Credit, Storage and account status')).toBeTruthy();
    expect(
      screen.getByRole('table', { name: 'User resource details' }),
    ).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
    expect(screen.getByText('bob@example.com')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Suspended')).toBeTruthy();
    expect(screen.getByTestId(`keco-admin-credit-used-${sampleUsers[0].id}`).textContent).toBe('7');
    expect(screen.getByTestId(`keco-admin-credit-remaining-${sampleUsers[0].id}`).textContent).toBe('99,999,993');
    expect(screen.getByTestId(`keco-admin-storage-used-${sampleUsers[0].id}`).textContent).toBe('324.7 GB');
    expect(screen.getByTestId(`keco-admin-storage-used-${sampleUsers[1].id}`).textContent).toBe('0 B');
    const [aliceRow] = screen.getAllByTestId('keco-admin-user-row');
    expect(aliceRow?.querySelectorAll('td')[1]?.textContent).toBe('\u2014');
    expect(aliceRow?.querySelectorAll('td')[3]?.textContent).toBe('324.7 GB');
    expect(screen.getAllByText('Incomplete usage')).toHaveLength(2);
    expect(screen.getByText('Exhausted')).toBeTruthy();
    expect(screen.getByText('Showing 2 of 9 users')).toBeTruthy();
    expect(screen.queryByText('User detail data is not connected')).toBeNull();
  });

  it('opens the administrator invitation dialog from the header command', () => {
    global.fetch = jest.fn(async () => response(200, overviewBody())) as never;

    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: 'Invite administrator' }));

    expect(screen.getByRole('dialog', { name: 'Invite administrator' })).toBeTruthy();
  });

  it('filters users by email search', async () => {
    global.fetch = jest.fn(async () => response(200, overviewBody())) as never;

    renderDashboard();
    await screen.findByText('alice@example.com');

    fireEvent.change(screen.getByLabelText('Search users'), {
      target: { value: 'bob@' },
    });

    expect(screen.queryByText('alice@example.com')).toBeNull();
    expect(screen.getByText('bob@example.com')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 9 users')).toBeTruthy();
  });

  it('shows stable loading UI without a false total', () => {
    global.fetch = jest.fn(() => new Promise(() => undefined)) as never;

    renderDashboard();

    expect(screen.getByTestId('keco-admin-total-loading')).toBeTruthy();
    expect(screen.getByTestId('keco-admin-credit-loading')).toBeTruthy();
    expect(screen.queryByTestId('keco-admin-total-users')).toBeNull();
    expect(screen.queryByTestId('keco-admin-credit-used')).toBeNull();
  });

  it('shows a first-load error and retries on command', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(503, { error: 'Unavailable' }))
      .mockResolvedValueOnce(response(200, overviewBody())) as never;

    renderDashboard();

    expect(await screen.findByText('Admin data could not be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect((await screen.findByTestId('keco-admin-total-users')).textContent).toContain('9');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last account and Credit values visible when a manual refresh fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(200, overviewBody()))
      .mockResolvedValueOnce(response(503, { error: 'Unavailable' })) as never;

    renderDashboard();
    expect((await screen.findByTestId('keco-admin-total-users')).textContent).toContain('9');
    expect(screen.getByTestId('keco-admin-credit-used').textContent).toBe('7');

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh admin data' }),
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Refresh failed. Showing the last synced values.')).toBeTruthy();
    expect(screen.getByTestId('keco-admin-total-users').textContent).toContain('9');
    expect(screen.getByTestId('keco-admin-credit-used').textContent).toBe('7');
    expect(screen.getByTestId('keco-admin-credit-remaining').textContent).toBe('99,999,993');
  });

  it.each([401, 403])('returns unauthorized users to projects on %i', async (status) => {
    global.fetch = jest.fn(async () => response(status, { error: 'Denied' })) as never;

    renderDashboard();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/projects'));
  });
});
