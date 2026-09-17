/** @jest-environment jsdom */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AccountCreditsSection } from '@/components/account/AccountCreditsSection';

type FetchResult = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const summary = {
  allocated: 100000000,
  used: 7,
  remaining: 99999993,
  overage: 0,
  deepseekTokens: 21,
  incompleteCount: 0,
  trackedFrom: '2026-09-17T00:00:00.000Z',
};

function response(status: number, body: unknown): FetchResult {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function renderCredits() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <AccountCreditsSection />
    </QueryClientProvider>,
  );
}

describe('AccountCreditsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('shows the account Credit ledger with formatted values', async () => {
    global.fetch = jest.fn(async () => response(200, summary)) as never;

    renderCredits();

    expect((await screen.findByTestId('account-credits-allocated')).textContent).toBe('100,000,000');
    expect(screen.getByTestId('account-credits-used').textContent).toBe('7');
    expect(screen.getByTestId('account-credits-remaining').textContent).toBe('99,999,993');
    expect(screen.getByText('Usage tracked since Sep 17, 2026')).toBeTruthy();
  });

  it('keeps three fixed Credit placeholders while loading', () => {
    global.fetch = jest.fn(() => new Promise(() => undefined)) as never;

    renderCredits();

    expect(screen.getByTestId('account-credits-loading')).toBeTruthy();
    expect(screen.getAllByTestId('account-credits-value-placeholder')).toHaveLength(3);
    expect(screen.queryByTestId('account-credits-remaining')).toBeNull();
  });

  it('warns when incomplete usage is excluded from Used', async () => {
    global.fetch = jest.fn(async () => response(200, {
      ...summary,
      incompleteCount: 2,
    })) as never;

    renderCredits();

    expect(
      await screen.findByText('2 usage records are awaiting final Credit totals and are not included in Used.'),
    ).toBeTruthy();
  });

  it('marks exhausted overage without hiding actual usage', async () => {
    global.fetch = jest.fn(async () => response(200, {
      ...summary,
      used: 100000005,
      remaining: 0,
      overage: 5,
    })) as never;

    renderCredits();

    expect((await screen.findByTestId('account-credits-used')).textContent).toBe('100,000,005');
    expect(screen.getByTestId('account-credits-remaining').textContent).toBe('0');
    expect(screen.getByRole('alert').textContent).toContain('Credit allocation exhausted. 5 Credits over allocation.');
  });

  it('does not show false zero values after a first-load failure and retries', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(503, { error: 'Unavailable' }))
      .mockResolvedValueOnce(response(200, summary)) as never;

    renderCredits();

    expect(await screen.findByText('Credit data could not be loaded')).toBeTruthy();
    expect(screen.queryByTestId('account-credits-allocated')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect((await screen.findByTestId('account-credits-remaining')).textContent).toBe('99,999,993');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
