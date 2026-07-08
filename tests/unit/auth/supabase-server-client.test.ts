import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ marker: 'supabase-client' })),
}));

const createClientMock = createClient as unknown as jest.MockedFunction<
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
});
