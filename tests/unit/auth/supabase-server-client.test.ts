import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ marker: 'supabase-client' })),
}));
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ marker: 'supabase-ssr-client' })),
  parseCookieHeader: jest.fn(() => [
    { name: 'sb-project-auth-token', value: 'cookie-session' },
  ]),
}));

const createClientMock = createClient as unknown as jest.MockedFunction<
  (url: string | undefined, key: string | undefined, options: unknown) => unknown
>;
const createServerClientMock = createServerClient as unknown as jest.MockedFunction<
  (url: string | undefined, key: string | undefined, options: unknown) => unknown
>;

describe('createSupabaseServerClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('passes the request authorization header to Supabase without browser session persistence', () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const client = createSupabaseServerClient(
      new Request('https://example.test/api/projects', {
        headers: { Authorization: 'Bearer server-token' },
      })
    );

    expect(client).toEqual({ marker: 'supabase-client' });
    expect(createClientMock).toHaveBeenCalledWith(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: 'Bearer server-token',
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );
  });

  it('reads a cookie session when the authorization header is absent', () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const client = createSupabaseServerClient(
      new Request('https://example.test/api/projects', {
        headers: { cookie: 'sb-project-auth-token=cookie-session' },
      })
    );

    expect(client).toEqual({ marker: 'supabase-ssr-client' });
    expect(createServerClientMock).toHaveBeenCalledWith(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      expect.objectContaining({
        cookies: expect.objectContaining({ getAll: expect.any(Function) }),
      })
    );
    const options = createServerClientMock.mock.calls[0][2] as {
      cookies: { getAll: () => Array<{ name: string; value: string }> };
    };
    expect(options.cookies.getAll()).toEqual([
      { name: 'sb-project-auth-token', value: 'cookie-session' },
    ]);
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
