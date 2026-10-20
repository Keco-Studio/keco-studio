/** @jest-environment jsdom */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameAssetsPage } from '@/components/admin/GameAssetsPage';

const message = { error: jest.fn(), success: jest.fn() };
const modalConfirm = jest.fn();

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock('antd', () => ({
  App: { useApp: () => ({ message }) },
  Modal: { confirm: (...args: unknown[]) => modalConfirm(...args) },
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

it('uses the application delete dialog and closes the selected asset only after confirmation', async () => {
  const asset = { id: 'manual:one', name: 'Forest.png', category: 'media', source: 'manual', status: 'ready', format: 'png', mimeType: 'image/png', previewUrl: null };
  global.fetch = jest.fn(async (_url, options) => ({
    ok: true, json: async () => options?.method === 'DELETE' ? {} : { assets: [asset], warnings: [] },
  })) as jest.Mock;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  modalConfirm.mockReset();
  renderPage();
  const card = await screen.findByRole('button', { name: 'Forest.png' });
  fireEvent.click(card);
  fireEvent.contextMenu(card);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(screen.getByRole('dialog', { name: 'Asset detail' })).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(modalConfirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Confirm deletion',
    content: expect.stringContaining('Forest.png'),
    okText: 'Delete',
    cancelText: 'Cancel',
    okButtonProps: { danger: true },
  }));
  const cancelled = modalConfirm.mock.calls[0][0] as { onCancel: () => void };
  cancelled.onCancel();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  fireEvent.contextMenu(card);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const confirmed = modalConfirm.mock.calls[1][0] as { onOk: () => Promise<void> };
  await confirmed.onOk();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asset detail' })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Forest.png' })).toBeNull();
});
