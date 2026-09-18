/** @jest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

import { AccountStorageSection } from '@/components/account/AccountStorageSection';
import { ACCOUNT_STORAGE_QUOTA_BYTES } from '@/lib/types/accountStorage';

type FetchResult = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SHARED_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const GIB = 1024 ** 3;

const summary = {
  quotaBytes: ACCOUNT_STORAGE_QUOTA_BYTES,
  usedBytes: Math.round(348.6 * GIB),
  physicalUsedBytes: 300 * GIB,
  logicalUsedBytes: Math.round(48.6 * GIB),
  reservedBytes: 0,
  remainingBytes: ACCOUNT_STORAGE_QUOTA_BYTES - Math.round(348.6 * GIB),
  overageBytes: 0,
  ownedProjects: [{
    id: PROJECT_ID,
    name: 'Rainy Manor',
    ownerName: 'Mina Park',
    fileCount: 3,
    usedBytes: Math.round(82.4 * GIB),
    ownedByCurrentUser: true,
  }, {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Empty Project',
    ownerName: 'Mina Park',
    fileCount: 0,
    usedBytes: 0,
    ownedByCurrentUser: true,
  }],
  sharedProjects: [{
    id: SHARED_PROJECT_ID,
    name: 'Moonlit Archive',
    ownerName: 'Kai Chen',
    fileCount: 3,
    usedBytes: 900 * GIB,
    ownedByCurrentUser: false,
  }],
  unassigned: { fileCount: 1, usedBytes: 512 },
};

const files = {
  items: [
    {
      id: 'file-1',
      name: 'manor_intro.mp4',
      mimeType: 'video/mp4',
      sizeBytes: Math.round(82.4 * GIB),
      sourceKind: 'project_asset',
      sourceEntityId: 'asset-1',
      createdAt: '2026-09-17T12:00:00.000Z',
      sourceAvailable: true,
    },
    {
      id: 'file-2',
      name: 'Story outline',
      mimeType: 'text/markdown',
      sizeBytes: 2048,
      sourceKind: 'document_content',
      sourceEntityId: 'document-1',
      createdAt: '2026-09-17T11:00:00.000Z',
      sourceAvailable: true,
    },
    {
      id: 'file-3',
      name: 'Characters',
      mimeType: 'application/x-keco-library+json',
      sizeBytes: 4096,
      sourceKind: 'library_table',
      sourceEntityId: 'library-1',
      createdAt: '2026-09-17T10:00:00.000Z',
      sourceAvailable: true,
    },
  ],
  total: 51,
  limit: 50,
  offset: 0,
};

function response(status: number, body: unknown): FetchResult {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function createStorageClient() {
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

function renderStorage(client = createStorageClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <AccountStorageSection />
      </QueryClientProvider>,
    ),
  };
}

function fetchStorage(summaryBody: unknown = summary, fileBody: unknown = files) {
  return jest.fn(async (input: string | URL) => {
    const url = String(input);
    if (url === '/api/account/storage') return response(200, summaryBody);
    if (url.startsWith('/api/account/storage/projects/')) return response(200, fileBody);
    return response(404, { error: 'Not found' });
  });
}

describe('AccountStorageSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchStorage() as never;
  });

  afterEach(() => {
    focusManager.setFocused(undefined);
    cleanup();
  });

  it('shows the quota summary and owned and shared project groups', async () => {
    renderStorage();

    expect((await screen.findByTestId('account-storage-used')).textContent).toBe('348.6 GB');
    expect(screen.getByText('1 TB')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('34');
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe('Storage used');
    expect(screen.getByLabelText('Storage usage breakdown').textContent).toContain('Files 300 GB');
    expect(screen.getByLabelText('Storage usage breakdown').textContent).toContain('Documents and tables 48.6 GB');
    expect(screen.getByText('My projects')).toBeTruthy();
    expect(screen.getByText('Shared with me')).toBeTruthy();
    expect(screen.getByText('Excluded from your allowance')).toBeTruthy();
    expect(screen.getByText('Unassigned legacy files')).toBeTruthy();
  });

  it('accepts accounts without a profile display name', async () => {
    global.fetch = fetchStorage({
      ...summary,
      ownedProjects: summary.ownedProjects.map((project) => ({ ...project, ownerName: '' })),
      sharedProjects: summary.sharedProjects.map((project) => ({ ...project, ownerName: '' })),
    }) as never;

    renderStorage();

    expect(await screen.findByTestId('account-storage-used')).toBeTruthy();
    expect(screen.getByText('Owned by Unknown owner')).toBeTruthy();
    expect(screen.queryByText('Storage data could not be loaded')).toBeNull();
  });

  it('keeps three stable storage placeholders while the summary loads', () => {
    global.fetch = jest.fn(() => new Promise(() => undefined)) as never;

    renderStorage();

    expect(screen.getByTestId('account-storage-summary').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByTestId('account-storage-value-placeholder')).toHaveLength(3);
    expect(screen.queryByTestId('account-storage-used')).toBeNull();
  });

  it('loads selected project files only after a project is selected', async () => {
    renderStorage();
    await screen.findByTestId('account-storage-used');

    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));

    expect(await screen.findByText('manor_intro.mp4')).toBeTruthy();
    expect(screen.getByText('82.4 GB')).toBeTruthy();
  });

  it('renders and opens a document whose stored name is blank', async () => {
    const blankDocumentFiles = {
      ...files,
      items: [{ ...files.items[1], name: '' }],
      total: 1,
    };
    global.fetch = fetchStorage(summary, blankDocumentFiles) as never;

    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));

    expect(await screen.findByText('Untitled document')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Untitled document location' }));
    expect(push).toHaveBeenLastCalledWith(`/${PROJECT_ID}/doc/document-1`);
    expect(screen.queryByText('Files could not be loaded for this project.')).toBeNull();
  });

  it('does not render false zero values after a first-load failure and retries', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(503, { error: 'Unavailable' }))
      .mockResolvedValueOnce(response(200, summary)) as never;

    renderStorage();

    expect(await screen.findByText('Storage data could not be loaded')).toBeTruthy();
    expect(screen.queryByTestId('account-storage-used')).toBeNull();
    expect(screen.queryByText('0 B')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect((await screen.findByTestId('account-storage-used')).textContent).toBe('348.6 GB');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last storage values visible when a refresh fails and retries', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(200, summary))
      .mockResolvedValueOnce(response(503, { error: 'Unavailable' }))
      .mockResolvedValueOnce(response(200, summary)) as never;
    const { client } = renderStorage();

    expect((await screen.findByTestId('account-storage-used')).textContent).toBe('348.6 GB');

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['account-storage'] });
    });

    expect(await screen.findByText('Storage data could not be refreshed. Showing the last loaded values.')).toBeTruthy();
    expect(screen.getByTestId('account-storage-used').textContent).toBe('348.6 GB');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.queryByText('Storage data could not be refreshed. Showing the last loaded values.')).toBeNull();
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    [80, 'Storage is 80% full. Consider freeing space before your projects reach their allowance.'],
    [95, 'Storage is 95% full. Free space soon to avoid blocked uploads.'],
    [100, 'Storage is full. New uploads are blocked until space is released or your allowance is increased.'],
  ])('warns at %i percent usage', async (percent, message) => {
    const usedBytes = Math.ceil(ACCOUNT_STORAGE_QUOTA_BYTES * percent / 100);
    global.fetch = fetchStorage({
      ...summary,
      usedBytes,
      physicalUsedBytes: usedBytes,
      logicalUsedBytes: 0,
      remainingBytes: ACCOUNT_STORAGE_QUOTA_BYTES - usedBytes,
      overageBytes: 0,
    }) as never;

    renderStorage();

    expect((await screen.findByRole('alert')).textContent).toContain(message);
  });

  it('shows a safe zero remaining value and the overage amount', async () => {
    global.fetch = fetchStorage({
      ...summary,
      usedBytes: ACCOUNT_STORAGE_QUOTA_BYTES + GIB,
      physicalUsedBytes: 300 * GIB,
      logicalUsedBytes: ACCOUNT_STORAGE_QUOTA_BYTES - 299 * GIB,
      remainingBytes: 0,
      overageBytes: GIB,
    }) as never;

    renderStorage();

    expect((await screen.findByText('Stored content exceeds the allowance by 1 GB.')).getAttribute('role')).toBe('alert');
    expect(screen.getByText('Remaining').parentElement?.textContent).toContain('0 B');
    expect(screen.queryByText(/Storage is full/)).toBeNull();
  });

  it('does not report physical storage as full when rounded display usage is 100 percent', async () => {
    const physicalUsedBytes = Math.ceil(ACCOUNT_STORAGE_QUOTA_BYTES * 0.995);
    global.fetch = fetchStorage({
      ...summary,
      usedBytes: physicalUsedBytes,
      physicalUsedBytes,
      logicalUsedBytes: 0,
      remainingBytes: ACCOUNT_STORAGE_QUOTA_BYTES - physicalUsedBytes,
      overageBytes: 0,
    }) as never;

    renderStorage();

    await screen.findByTestId('account-storage-used');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByRole('alert').textContent).toContain('Storage is 95% full');
    expect(screen.queryByText(/Storage is full/)).toBeNull();
  });

  it('does not add shared project bytes to the owner summary', async () => {
    renderStorage();

    expect((await screen.findByTestId('account-storage-used')).textContent).toBe('348.6 GB');
    expect(screen.getByRole('button', { name: /Moonlit Archive.*900 GB/ })).toBeTruthy();
  });

  it('shows shared project ownership and empty project state', async () => {
    renderStorage();
    await screen.findByTestId('account-storage-used');

    expect(screen.getByText('Owned by Kai Chen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Empty Project/ }));
    expect(await screen.findByText('This project has no stored files.')).toBeTruthy();
  });

  it('debounces filename search and requests the matching server page', async () => {
    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));
    await screen.findByText('manor_intro.mp4');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search files' }), { target: { value: 'intro' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining('query=intro'), expect.anything());
    }, { timeout: 1000 });
  });

  it('passes sort and pagination choices to the server', async () => {
    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));
    await screen.findByText('manor_intro.mp4');

    fireEvent.change(screen.getByLabelText('Sort files'), { target: { value: 'name_asc' } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining('sort=name_asc'), expect.anything());
    });
    await screen.findByText('manor_intro.mp4');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining('offset=50'), expect.anything());
    });
  });

  it('disables unavailable source locations and navigates available locations using the closed source switch', async () => {
    const unavailableFiles = {
      ...files,
      items: [{ ...files.items[0], id: 'missing', name: 'missing.png', sourceAvailable: false, sourceKind: 'legacy_unassigned' }],
      total: 1,
    };
    global.fetch = fetchStorage(summary, unavailableFiles) as never;

    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));

    expect(await screen.findByText('Source no longer exists')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open missing.png location' }).hasAttribute('disabled')).toBe(true);
  });

  it.each([
    ['project_asset', 'asset-1', `/${PROJECT_ID}/admin/assets`],
    ['map_asset', 'asset-1', `/${PROJECT_ID}/admin/assets`],
    ['character_asset', 'asset-1', `/${PROJECT_ID}/admin/assets`],
    ['map_reference', 'asset-1', `/create-map?projectId=${PROJECT_ID}`],
    ['document_image', 'document-1', `/${PROJECT_ID}/doc/document-1`],
    ['document_content', 'document-1', `/${PROJECT_ID}/doc/document-1`],
    ['library_table', 'library-1', `/${PROJECT_ID}/library-1`],
    ['document_image', null, `/${PROJECT_ID}`],
    ['library_media', 'library-media-1', `/${PROJECT_ID}`],
  ])('opens the approved %s source route', async (sourceKind, sourceEntityId, route) => {
    const sourceFiles = {
      ...files,
      items: [{ ...files.items[0], sourceKind, sourceEntityId }],
      total: 1,
    };
    global.fetch = fetchStorage(summary, sourceFiles) as never;

    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));
    await screen.findByText('manor_intro.mp4');
    fireEvent.click(screen.getByRole('button', { name: 'Open manor_intro.mp4 location' }));

    expect(push).toHaveBeenLastCalledWith(route);
  });

  it('marks the explorer as stacked on mobile while retaining semantic controls', async () => {
    const { container } = renderStorage();

    await screen.findByTestId('account-storage-used');
    expect(container.querySelector('[data-testid="account-storage-explorer"]')?.getAttribute('data-stacks-on-mobile')).toBe('true');
    expect(screen.getByRole('searchbox', { name: 'Search files' })).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });
});
