/** @jest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { AccountStorageSection } from '@/components/account/AccountStorageSection';
import { ACCOUNT_STORAGE_QUOTA_BYTES } from '@/lib/types/accountStorage';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TABLE_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const ROW_ID = '55555555-5555-4555-8555-555555555555';
const FOLDER_ID = '77777777-7777-4777-8777-777777777777';
const GIB = 1024 ** 3;

const summary = {
  quotaBytes: ACCOUNT_STORAGE_QUOTA_BYTES,
  usedBytes: Math.round(348.6 * GIB),
  physicalUsedBytes: 300 * GIB,
  logicalUsedBytes: Math.round(48.6 * GIB),
  reservedBytes: 0,
  remainingBytes: ACCOUNT_STORAGE_QUOTA_BYTES - Math.round(348.6 * GIB),
  overageBytes: 0,
  ownedProjects: [{ id: PROJECT_ID, name: 'Rainy Manor', ownerName: 'Mina Park', fileCount: 3, usedBytes: 24_000, ownedByCurrentUser: true }],
  sharedProjects: [{ id: '66666666-6666-4666-8666-666666666666', name: 'Moonlit Archive', ownerName: 'Kai Chen', fileCount: 1, usedBytes: 900 * GIB, ownedByCurrentUser: false }],
  unassigned: { fileCount: 1, usedBytes: 512 },
};

const entities = {
  items: [{
    id: TABLE_ID,
    kind: 'table',
    name: 'Characters',
    mimeType: 'application/x-keco-table',
    logicalBytes: 1000,
    physicalBytes: 12_000,
    sizeBytes: 13_000,
    parentFolderId: null,
    createdAt: '2026-09-17T12:00:00.000Z',
    sourceAvailable: true,
  }, {
    id: DOCUMENT_ID,
    kind: 'document',
    name: 'Design document',
    mimeType: 'application/x-keco-document',
    logicalBytes: 3000,
    physicalBytes: 2000,
    sizeBytes: 5000,
    parentFolderId: null,
    createdAt: '2026-09-16T12:00:00.000Z',
    sourceAvailable: true,
  }, {
    id: PROJECT_ID,
    kind: 'assets',
    name: 'Assets',
    mimeType: 'application/x-keco-assets',
    logicalBytes: 0,
    physicalBytes: 6000,
    sizeBytes: 6000,
    parentFolderId: null,
    createdAt: '2026-09-15T12:00:00.000Z',
    sourceAvailable: true,
  }],
  total: 51,
  limit: 50,
  offset: 0,
  breadcrumb: [],
};

const tableDetail = {
  id: TABLE_ID,
  kind: 'table',
  name: 'Characters',
  logicalBytes: 1000,
  physicalBytes: 12_000,
  sizeBytes: 13_000,
  sourceAvailable: true,
  items: [{ id: DOCUMENT_ID, name: 'Table data', mimeType: 'application/x-keco-library+json', sizeBytes: 1000, itemKind: 'logical', groupId: null, groupName: null, createdAt: '2026-09-17T12:00:00.000Z' }, { id: MEDIA_ID, name: 'alice.png', mimeType: 'image/png', sizeBytes: 12_000, itemKind: 'media', groupId: ROW_ID, groupName: 'Alice', createdAt: '2026-09-17T12:00:00.000Z' }],
};

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fetchStorage(summaryBody: unknown = summary, entityBody: unknown = entities, detailBody: unknown = tableDetail) {
  return jest.fn(async (input: string | URL) => {
    const url = String(input);
    if (url === '/api/account/storage') return response(200, summaryBody);
    if (/\/entities\/(table|document|assets)\//.test(url)) return response(200, detailBody);
    if (url.includes('/entities?')) return response(200, entityBody);
    return response(404, { error: 'Not found' });
  });
}

function renderStorage(client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 120_000, gcTime: 300_000, refetchOnMount: false, refetchOnWindowFocus: false } } })) {
  return { client, ...render(<QueryClientProvider client={client}><AccountStorageSection /></QueryClientProvider>) };
}

describe('AccountStorageSection', () => {
  beforeEach(() => { jest.clearAllMocks(); global.fetch = fetchStorage() as never; });
  afterEach(() => { focusManager.setFocused(undefined); cleanup(); });

  it('shows quota totals and owned/shared project aggregates', async () => {
    renderStorage();
    expect((await screen.findByTestId('account-storage-used')).textContent).toBe('348.6 GB');
    expect(screen.getByLabelText('Storage usage breakdown').textContent).toContain('Media 300 GB');
    expect(screen.getByLabelText('Storage usage breakdown').textContent).toContain('Content 48.6 GB');
    expect(screen.getByRole('button', { name: /Rainy Manor.*3 items/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Moonlit Archive.*900 GB/ })).toBeTruthy();
    expect(screen.getByText('Excluded from your allowance')).toBeTruthy();
  });

  it('shows only Table, Document, and Assets rows at the project level', async () => {
    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));

    expect(await screen.findByText('Characters')).toBeTruthy();
    expect(screen.getByText('Design document')).toBeTruthy();
    expect(screen.getByText('Assets')).toBeTruthy();
    expect(screen.queryByText('alice.png')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('opens Folder rows as directories and returns through the breadcrumb', async () => {
    const rootPage = {
      items: [{
        id: FOLDER_ID,
        kind: 'folder',
        name: 'Characters folder',
        mimeType: 'application/x-keco-folder',
        logicalBytes: 4000,
        physicalBytes: 14_000,
        sizeBytes: 18_000,
        parentFolderId: null,
        createdAt: '2026-09-14T12:00:00.000Z',
        sourceAvailable: true,
      }, entities.items[2]],
      total: 2,
      limit: 50,
      offset: 0,
      breadcrumb: [],
    };
    const childPage = {
      items: entities.items.slice(0, 2).map((item) => ({ ...item, parentFolderId: FOLDER_ID })),
      total: 2,
      limit: 50,
      offset: 0,
      breadcrumb: [{ id: FOLDER_ID, name: 'Characters folder' }],
    };
    global.fetch = jest.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === '/api/account/storage') return response(200, summary);
      if (url.includes('/entities?')) {
        return response(200, url.includes(`parentFolderId=${FOLDER_ID}`) ? childPage : rootPage);
      }
      if (/\/entities\/(table|document|assets)\//.test(url)) return response(200, tableDetail);
      return response(404, { error: 'Not found' });
    }) as never;

    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor.*3 items/ }));
    fireEvent.click((await screen.findByText('Characters folder')).closest('button')!);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`parentFolderId=${FOLDER_ID}`),
      expect.anything(),
    ));
    expect(await screen.findByText('Characters')).toBeTruthy();
    expect(screen.getByText('Design document')).toBeTruthy();
    expect(screen.queryByText('Assets')).toBeNull();
    expect(screen.queryByLabelText('Characters folder storage details')).toBeNull();

    const path = screen.getByRole('navigation', { name: 'Project storage path' });
    expect(path.textContent).toContain('Rainy Manor');
    expect(path.textContent).toContain('Characters folder');
    fireEvent.click(path.querySelector('button')!);
    await screen.findByText('Assets');
    await waitFor(() => {
      const entityRequests = (global.fetch as jest.Mock).mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes('/entities?'));
      expect(entityRequests.at(-1)).not.toContain('parentFolderId');
    });
  });

  it('keeps a failed Folder path for retry and resets the path when projects change', async () => {
    const rootPage = {
      items: [{
        id: FOLDER_ID,
        kind: 'folder',
        name: 'Characters folder',
        mimeType: 'application/x-keco-folder',
        logicalBytes: 4000,
        physicalBytes: 14_000,
        sizeBytes: 18_000,
        parentFolderId: null,
        createdAt: '2026-09-14T12:00:00.000Z',
        sourceAvailable: true,
      }],
      total: 1,
      limit: 50,
      offset: 0,
      breadcrumb: [],
    };
    global.fetch = jest.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === '/api/account/storage') return response(200, summary);
      if (url.includes(`parentFolderId=${FOLDER_ID}`)) return response(503, { error: 'Unavailable' });
      if (url.includes('/entities?')) return response(200, rootPage);
      return response(404, { error: 'Not found' });
    }) as never;

    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor.*3 items/ }));
    fireEvent.click((await screen.findByText('Characters folder')).closest('button')!);
    expect(await screen.findByText('Project items could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Project storage path' }).textContent)
      .toContain('Characters folder');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.filter(
      (call) => String(call[0]).includes(`parentFolderId=${FOLDER_ID}`),
    )).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /Moonlit Archive.*900 GB/ }));
    await waitFor(() => {
      const entityRequests = (global.fetch as jest.Mock).mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes('/entities?'));
      expect(entityRequests.at(-1)).toContain('/66666666-6666-4666-8666-666666666666/entities?');
      expect(entityRequests.at(-1)).not.toContain('parentFolderId');
    });
    const path = screen.getByRole('navigation', { name: 'Project storage path' });
    expect(path.textContent).toBe('Moonlit Archive');
  });

  it('opens a Table breakdown while keeping actual media out of the top-level list', async () => {
    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));
    fireEvent.click((await screen.findByText('Characters')).closest('button')!);

    const detail = await screen.findByLabelText('Characters storage details');
    expect(detail.textContent).toContain('12.7 KB');
    await screen.findByText('Alice');
    expect(detail.textContent).toContain('Alice');
    expect(detail.textContent).toContain('alice.png');
    expect(screen.getByRole('list', { name: 'Project storage items' }).textContent).not.toContain('alice.png');

    fireEvent.click(screen.getByRole('button', { name: 'Open Table' }));
    expect(push).toHaveBeenCalledWith(`/${PROJECT_ID}/${TABLE_ID}`);
    fireEvent.click(screen.getByRole('button', { name: 'Close storage details' }));
    expect(screen.queryByLabelText('Characters storage details')).toBeNull();
  });

  it('shows retryable entity and detail failures', async () => {
    global.fetch = jest.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === '/api/account/storage') return response(200, summary);
      return response(503, { error: 'Unavailable' });
    }) as never;
    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));
    expect(await screen.findByText('Project items could not be loaded.')).toBeTruthy();

    global.fetch = fetchStorage() as never;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click((await screen.findByText('Characters')).closest('button')!);
    expect(await screen.findByText('Table data')).toBeTruthy();
  });

  it('debounces entity search and sends sort and pagination choices', async () => {
    renderStorage();
    await screen.findByTestId('account-storage-used');
    fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));
    await screen.findByText('Characters');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search folders, tables, documents, assets' }), { target: { value: 'char' } });
    await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining('query=char'), expect.anything()), { timeout: 1000 });
    fireEvent.change(screen.getByLabelText('Sort items'), { target: { value: 'name_asc' } });
    await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining('sort=name_asc'), expect.anything()));
    await screen.findByText('Characters');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining('offset=50'), expect.anything()));
  });

  it('retains first-load, stale-refresh, quota warning, and mobile-stack behavior', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(response(503, {})).mockResolvedValueOnce(response(200, summary)) as never;
    const first = renderStorage();
    expect(await screen.findByText('Storage data could not be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('account-storage-used')).toBeTruthy();
    expect(first.container.querySelector('[data-stacks-on-mobile="true"]')).toBeTruthy();
    cleanup();

    const usedBytes = Math.ceil(ACCOUNT_STORAGE_QUOTA_BYTES * 0.95);
    global.fetch = fetchStorage({ ...summary, usedBytes, physicalUsedBytes: usedBytes, logicalUsedBytes: 0, remainingBytes: ACCOUNT_STORAGE_QUOTA_BYTES - usedBytes }) as never;
    renderStorage();
    expect((await screen.findByRole('alert')).textContent).toContain('Storage is 95% full');
  });

  it('keeps loaded summary values when a refresh fails', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(response(200, summary)).mockResolvedValueOnce(response(503, {})).mockResolvedValueOnce(response(200, summary)) as never;
    const { client } = renderStorage();
    await screen.findByTestId('account-storage-used');
    await act(async () => { await client.invalidateQueries({ queryKey: ['account-storage'] }); });
    expect(await screen.findByText('Storage data could not be refreshed. Showing the last loaded values.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Storage data could not be refreshed. Showing the last loaded values.')).toBeNull());
  });
});
