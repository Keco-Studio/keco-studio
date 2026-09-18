/** @jest-environment jsdom */

import React from 'react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function createCreditsClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 2 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function renderCredits(client = createCreditsClient()) {

  const result = render(
    <QueryClientProvider client={client}>
      <AccountCreditsSection />
    </QueryClientProvider>,
  );

  return { client, ...result };
}

describe('AccountCreditsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    focusManager.setFocused(undefined);
    cleanup();
  });

  it('shows the account Credit ledger with formatted values', async () => {
    global.fetch = jest.fn(async () => response(200, summary)) as never;

    renderCredits();

    expect((await screen.findByTestId('account-credits-allocated')).textContent).toBe('100,000,000');
    expect(screen.getByTestId('account-credits-used').textContent).toBe('7');
    expect(screen.getByTestId('account-credits-remaining').textContent).toBe('99,999,993');
    expect(screen.getByText('Usage tracked since Sep 17, 2026')).toBeTruthy();
  });

  it('shows cost-based Credit usage without rounding a small balance to zero', async () => {
    global.fetch = jest.fn(async () => response(200, {
      ...summary,
      used: 0.0000819,
      remaining: 99_999_999.9999181,
    })) as never;

    renderCredits();

    expect((await screen.findByTestId('account-credits-used')).textContent).toBe('0.000082');
    expect(screen.getByTestId('account-credits-remaining').textContent).toBe('99,999,999.999918');
  });

  it('keeps three fixed Credit placeholders while loading', () => {
    global.fetch = jest.fn(() => new Promise(() => undefined)) as never;

    renderCredits();

    expect(screen.getByTestId('account-credits-loading').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByTestId('account-credits-value-placeholder')).toHaveLength(3);
    expect(screen.queryByTestId('account-credits-remaining')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Loading Credits');
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

  it('uses singular grammar for one incomplete usage record', async () => {
    global.fetch = jest.fn(async () => response(200, {
      ...summary,
      incompleteCount: 1,
    })) as never;

    renderCredits();

    expect(
      await screen.findByText('1 usage record is awaiting final Credit totals and is not included in Used.'),
    ).toBeTruthy();
  });

  it('loads a fresh balance when the section is revisited with cached data', async () => {
    const refreshedSummary = {
      ...summary,
      allocated: 200_000_000,
      remaining: 199_999_993,
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(200, summary))
      .mockResolvedValueOnce(response(200, refreshedSummary)) as never;
    const client = createCreditsClient();

    const firstVisit = renderCredits(client);
    expect((await screen.findByTestId('account-credits-allocated')).textContent).toBe('100,000,000');
    firstVisit.unmount();

    renderCredits(client);

    await waitFor(() => {
      expect(screen.getByTestId('account-credits-allocated').textContent).toBe('200,000,000');
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('loads a fresh balance when the window regains focus', async () => {
    const refreshedSummary = {
      ...summary,
      used: 10,
      remaining: 99_999_990,
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(200, summary))
      .mockResolvedValueOnce(response(200, refreshedSummary)) as never;
    focusManager.setFocused(false);

    renderCredits();
    expect((await screen.findByTestId('account-credits-used')).textContent).toBe('7');

    act(() => focusManager.setFocused(true));

    await waitFor(() => {
      expect(screen.getByTestId('account-credits-used').textContent).toBe('10');
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
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

  it('keeps the last Credit values visible when a refresh fails and retries', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(200, summary))
      .mockResolvedValueOnce(response(503, { error: 'Unavailable' }))
      .mockResolvedValueOnce(response(200, summary)) as never;

    const { client } = renderCredits();
    expect((await screen.findByTestId('account-credits-remaining')).textContent).toBe('99,999,993');

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['account-credits'] });
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('account-credits-remaining').textContent).toBe('99,999,993');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Credit data could not be refreshed. Showing the last loaded values.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.queryByText('Credit data could not be refreshed. Showing the last loaded values.')).toBeNull();
    });
    expect(screen.getByTestId('account-credits-remaining').textContent).toBe('99,999,993');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
