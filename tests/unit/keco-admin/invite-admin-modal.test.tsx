/** @jest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getSession = jest.fn();

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => ({ auth: { getSession } }),
}));

import { InviteAdminModal } from '@/components/keco-admin/InviteAdminModal';

describe('InviteAdminModal', () => {
  let getComputedStyleSpy: jest.SpyInstance;

  beforeAll(() => {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    getComputedStyleSpy = jest
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((element) => nativeGetComputedStyle(element));
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  });

  afterAll(() => {
    getComputedStyleSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } } });
  });

  afterEach(cleanup);

  it('grants Admin access to a registered user email', async () => {
    const onClose = jest.fn();
    const onSuccess = jest.fn();
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'granted', email: 'target@example.com' }),
    })) as never;

    render(
      <InviteAdminModal open onClose={onClose} onSuccess={onSuccess} />,
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: ' Target@Example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Grant Admin access' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/keco-admin/admins',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
        body: JSON.stringify({ email: 'target@example.com' }),
      }),
    ));
    expect(onSuccess).toHaveBeenCalledWith('granted', 'target@example.com');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error when the administrator grant request fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('Network unavailable');
    }) as never;

    render(
      <InviteAdminModal open onClose={jest.fn()} onSuccess={jest.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'target@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Grant Admin access' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Unable to grant Admin access');
  });
});
