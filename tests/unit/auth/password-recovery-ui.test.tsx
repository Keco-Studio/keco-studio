/** @jest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockPush = jest.fn();
const mockResetPasswordForEmail = jest.fn();
const mockSupabase = {
  auth: { resetPasswordForEmail: mockResetPasswordForEmail },
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => mockSupabase,
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    src,
    alt,
    fill: _fill,
    priority: _priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
  }) => React.createElement('img', { src: String(src), alt, ...props }),
}));

jest.mock('@/assets/images/loginImg_2.png', () => 'login-image');
jest.mock('@/assets/images/loginArrowIcon.svg', () => 'back-icon');
jest.mock('@/assets/images/loginMessageIcon.svg', () => 'message-icon');
jest.mock('@/assets/images/loginProductIcon.svg', () => 'product-icon');
jest.mock('@/assets/images/loginQuestionIcon.svg', () => 'question-icon');
jest.mock('@/assets/images/loginServiceIcon.svg', () => 'service-icon');

import ForgotPasswordPage from '@/app/forgot-password/page';
import AuthForm from '@/components/authform/AuthForm';

describe('password recovery request UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('accepts only an email and shows a non-enumerating success message', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    render(<ForgotPasswordPage />);

    const emailInput = screen.getByLabelText('Email', { exact: true });
    expect(emailInput.getAttribute('placeholder')).toBe('type your email...');
    expect(emailInput.getAttribute('type')).toBe('email');

    fireEvent.change(emailInput, {
      target: { value: '  User@Example.COM ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => {
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        'user@example.com',
        { redirectTo: `${window.location.origin}/auth/reset-password` }
      );
    });
    expect(
      await screen.findByText(
        'If an account exists for this email, you will receive a password reset link.'
      )
    ).toBeTruthy();
  });

  it('does not expose provider details when delivery cannot be requested', async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      data: null,
      error: new Error('SMTP host secret.internal refused connection'),
    });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email', { exact: true }), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(
      await screen.findByText('Unable to send a password reset email. Try again later.')
    ).toBeTruthy();
    expect(screen.queryByText(/secret\.internal/i)).toBeNull();
  });

  it('links to password recovery with the correct login copy', () => {
    render(<AuthForm />);

    expect(
      screen.getByRole('button', { name: 'Forgot your password?' })
    ).toBeTruthy();
  });
});
