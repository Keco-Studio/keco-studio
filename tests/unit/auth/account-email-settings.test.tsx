/** @jest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const getUser = jest.fn();
const updateUser = jest.fn();
const mockSupabase = {
  auth: { getUser, updateUser },
};

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => mockSupabase,
}));

import { AccountEmailSettings } from '@/components/account/AccountEmailSettings';

describe('account email settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUser.mockResolvedValue({
      data: {
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'current@example.com',
        },
      },
      error: null,
    });
  });

  afterEach(() => cleanup());

  it('loads the authoritative current email from Auth', async () => {
    render(<AccountEmailSettings />);

    expect(await screen.findByText('current@example.com')).toBeTruthy();
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('rejects an unchanged normalized email without requesting a change', async () => {
    render(<AccountEmailSettings />);
    await screen.findByText('current@example.com');

    fireEvent.change(screen.getByLabelText('New email'), {
      target: { value: '  CURRENT@EXAMPLE.COM ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

    expect(await screen.findByText('Enter a different email address.')).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('normalizes the new email and waits for confirmation before claiming success', async () => {
    updateUser.mockResolvedValue({ data: { user: {} }, error: null });
    render(<AccountEmailSettings />);
    await screen.findByText('current@example.com');

    fireEvent.change(screen.getByLabelText('New email'), {
      target: { value: '  New.Address+tag@Example.COM ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith(
        { email: 'new.address+tag@example.com' },
        {
          emailRedirectTo: `${window.location.origin}/auth/callback?redirect=/account`,
        }
      );
    });
    expect(
      await screen.findByText(
        'Confirm the email change using the messages sent to your email addresses.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Email changed successfully')).toBeNull();
  });

  it('reports a duplicate current email without changing the displayed email', async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: new Error('Email address is already in use'),
    });
    render(<AccountEmailSettings />);
    await screen.findByText('current@example.com');

    fireEvent.change(screen.getByLabelText('New email'), {
      target: { value: 'owned@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

    expect(
      await screen.findByText('An account with this email already exists.')
    ).toBeTruthy();
    expect(screen.getByText('current@example.com')).toBeTruthy();
  });
});
