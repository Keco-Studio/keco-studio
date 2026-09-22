/** @jest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const getUser = jest.fn();
const updateUser = jest.fn();
const verifyOtp = jest.fn();
const mockSupabase = {
  auth: { getUser, updateUser, verifyOtp },
};

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => mockSupabase,
}));

import { AccountEmailSettings } from '@/components/account/AccountEmailSettings';

describe('account email settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateUser.mockResolvedValue({ data: { user: null }, error: null });
    verifyOtp.mockResolvedValue({ data: { user: null }, error: null });
    getUser.mockResolvedValue({
      data: {
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'current@example.com',
          user_metadata: {},
        },
      },
      error: null,
    });
  });

  afterEach(() => cleanup());

  it('shows the authoritative current email and change controls', async () => {
    render(<AccountEmailSettings />);

    expect(await screen.findByText('current@example.com')).toBeTruthy();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Current email')).toBeTruthy();
    expect(screen.getByLabelText('New email')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change email' })).toBeTruthy();
  });

  it('does not request a change when the old email identity does not match', async () => {
    render(<AccountEmailSettings />);
    await screen.findByText('current@example.com');
    fireEvent.change(screen.getByLabelText('Current email'), { target: { value: 'wrong@example.com' } });
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Current email does not match');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('requests an email change and verifies the OTP', async () => {
    updateUser.mockResolvedValueOnce({ data: { user: { email: 'current@example.com', new_email: 'new@example.com' } }, error: null });
    getUser
      .mockResolvedValueOnce({ data: { user: { email: 'current@example.com', user_metadata: {} } }, error: null })
      .mockResolvedValueOnce({ data: { user: { email: 'new@example.com', user_metadata: {} } }, error: null });
    render(<AccountEmailSettings />);
    await screen.findByText('current@example.com');
    fireEvent.change(screen.getByLabelText('Current email'), { target: { value: 'current@example.com' } });
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
    await screen.findByLabelText('Verification code');
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({
      email: 'new@example.com',
      token: '123456',
      type: 'email_change',
    }));
    expect(await screen.findByText('new@example.com')).toBeTruthy();
  });
});
