/** @jest-environment jsdom */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameAssetsPage } from '@/components/admin/GameAssetsPage';

const message = { error: jest.fn(), success: jest.fn() };

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock('antd', () => ({
  App: { useApp: () => ({ message }) },
  Button: ({ children, loading: _loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) =>
    <button type="button" {...props}>{children}</button>,
  Spin: () => <span>Loading</span>,
}));
jest.mock('@ant-design/icons', () => ({
  DownloadOutlined: () => null,
  FileImageOutlined: () => null,
  FileOutlined: () => null,
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GameAssetsPage projectId="project-1" />
    </QueryClientProvider>,
  );
}

describe('GameAssetsPage upload actions', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ assets: [], warnings: [] }) })) as jest.Mock;
    global.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
  });

  it('does not render a second upload control inside the asset page', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('No assets in this view')).toBeTruthy());

    expect(screen.queryByRole('button', { name: 'Upload assets' })).toBeNull();
  });
});

it('uses the sidebar delete dialog and closes the selected asset only after confirmation', async () => {
  const asset = { id: 'manual:one', name: 'Forest.png', category: 'media', source: 'manual', status: 'ready', format: 'png', mimeType: 'image/png', previewUrl: null };
  global.fetch = jest.fn(async (_url, options) => ({
    ok: true, json: async () => options?.method === 'DELETE' ? {} : { assets: [asset], warnings: [] },
  })) as jest.Mock;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  renderPage();
  const card = await screen.findByRole('button', { name: 'Forest.png' });
  fireEvent.click(card);
  fireEvent.contextMenu(card);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(screen.getByRole('dialog', { name: 'Asset detail' })).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const deleteDialog = screen.getByRole('alertdialog', { name: 'Confirm deletion' });
  expect(deleteDialog.textContent).toContain('Forest.png');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(global.fetch).toHaveBeenCalledTimes(1);
  fireEvent.contextMenu(card);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asset detail' })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Forest.png' })).toBeNull();
});
