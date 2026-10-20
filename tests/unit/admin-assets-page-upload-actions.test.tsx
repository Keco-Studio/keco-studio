/** @jest-environment jsdom */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
