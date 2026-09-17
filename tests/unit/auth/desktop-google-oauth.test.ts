/** @jest-environment jsdom */

import { beginDesktopGoogleOAuth } from '@/lib/desktopGoogleOAuth';

describe('desktop Google OAuth bridge', () => {
  it('invokes only the desktop Google command with an empty object', async () => {
    const invoke = jest.fn().mockResolvedValue({ status: 'completed' });
    Object.defineProperty(window, 'zero', { configurable: true, value: { invoke } });

    await beginDesktopGoogleOAuth();

    expect(invoke).toHaveBeenCalledWith('desktop.begin_google_oauth', {});
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('fails safely when the Native SDK bridge is absent', async () => {
    Object.defineProperty(window, 'zero', { configurable: true, value: undefined });

    await expect(beginDesktopGoogleOAuth()).rejects.toThrow('Desktop sign-in is unavailable');
  });
});
