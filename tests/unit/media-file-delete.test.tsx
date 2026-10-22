/** @jest-environment jsdom */

import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { MediaFileUpload } from '@/components/media/MediaFileUpload';
import type { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';

const supabase = {};

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
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => supabase }));
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
jest.mock('@/lib/services/mediaFileUploadService', () => ({
  isImageFile: (fileType: string) => fileType.startsWith('image/'),
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

describe('MediaFileUpload table cell interactions', () => {
  it('opens an image preview only on double-click', () => {
    const value: MediaFileMetadata = {
      url: 'data:image/png;base64,AA==',
      path: 'user-1/project-1/image',
      fileName: 'image.png',
      fileSize: 64,
      fileType: 'image/png',
      uploadedAt: '2026-10-20T00:00:00.000Z',
    };

    render(<MediaFileUpload value={value} onChange={() => undefined} fieldType="image" inTableCell />);

    const preview = screen.getByRole('img', { name: 'image.png' });
    fireEvent.click(preview);
    expect(screen.queryByRole('dialog', { name: 'image.png' })).toBeNull();
    fireEvent.doubleClick(preview);
    expect(screen.getByRole('dialog', { name: 'image.png' })).toBeTruthy();
  });

  it('opens a file only on double-click', () => {
    const value: MediaFileMetadata = {
      url: 'https://example.test/file',
      path: 'user-1/project-1/file',
      fileName: 'document.pdf',
      fileSize: 64,
      fileType: 'application/pdf',
      uploadedAt: '2026-10-20T00:00:00.000Z',
    };
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);

    render(<MediaFileUpload value={value} onChange={() => undefined} fieldType="file" inTableCell />);

    const file = screen.getByLabelText('document.pdf');
    fireEvent.click(file);
    expect(open).not.toHaveBeenCalled();
    fireEvent.doubleClick(file);
    expect(open).toHaveBeenCalledWith(value.url, '_blank', 'noopener,noreferrer');
  });
});
