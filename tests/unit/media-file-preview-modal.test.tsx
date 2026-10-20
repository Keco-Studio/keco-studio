/** @jest-environment jsdom */

import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { MediaFileUpload } from '@/components/media/MediaFileUpload';
import type { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ unoptimized: _unoptimized, ...props }: Record<string, unknown>) =>
    React.createElement('img', props),
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ projectId: 'project-1' }) }));
jest.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: jest.fn() } }) },
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));
jest.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    userProfile: { id: 'user-1' },
  }),
}));
jest.mock('@/lib/hooks/useProjectRoleQuery', () => ({
  useProjectRoleQuery: () => ({ data: { isOwner: true } }),
}));
jest.mock('@/components/media/MediaFileUpload.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverStub,
});

const image: MediaFileMetadata = {
  url: 'data:image/webp;base64,UklGRg==',
  path: 'project-1/file.webp',
  fileName: 'file.webp',
  fileSize: 64,
  fileType: 'image/webp',
  uploadedAt: '2026-10-20T00:00:00.000Z',
};

describe('MediaFileUpload image preview', () => {
  it('portals the preview overlay to the document body so it covers the full app', () => {
    const tableRegion = document.createElement('div');
    tableRegion.style.transform = 'translateX(0)';
    document.body.appendChild(tableRegion);

    render(
      <MediaFileUpload
        value={image}
        onChange={() => undefined}
        fieldType="image"
        inTableCell
      />,
      { container: tableRegion },
    );

    fireEvent.click(screen.getByRole('img', { name: 'file.webp' }));

    const overlay = document.body.querySelector('.modalOverlay');
    expect(overlay).toBeTruthy();
    expect(overlay?.parentElement).toBe(document.body);
  });
});
