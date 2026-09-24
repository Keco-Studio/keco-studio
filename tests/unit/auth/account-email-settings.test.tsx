/** @jest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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

  it('shows the authoritative current email without email-change controls', async () => {
    render(<AccountEmailSettings />);

    expect(await screen.findByText('current@example.com')).toBeTruthy();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('New email')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change email' })).toBeNull();
    expect(screen.queryByLabelText('Verification code')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify email' })).toBeNull();
    expect(updateUser).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
