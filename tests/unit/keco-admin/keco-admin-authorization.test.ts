jest.mock('server-only', () => ({}));

import {
  hasKecoAdminAccess,
  isKecoAdminUser,
} from '@/lib/server/kecoAdminAuthorization';

const ADMIN_ID = 'aae0969f-0cb2-4632-8624-b9f40f2f4543';

describe('Keco Admin authorization', () => {
  it('allows only an exact configured UUID match', () => {
    expect(isKecoAdminUser(ADMIN_ID, ADMIN_ID)).toBe(true);
    expect(
      isKecoAdminUser(
        '11111111-1111-4111-8111-111111111111',
        ADMIN_ID,
      ),
    ).toBe(false);
  });

  it.each([
    undefined,
    '',
    ` ${ADMIN_ID}`,
    `${ADMIN_ID} `,
    'not-a-uuid',
  ])('fails closed for invalid configuration %p', (configuredId) => {
    expect(isKecoAdminUser(ADMIN_ID, configuredId)).toBe(false);
  });

  it('allows any user present in the admin table', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { user_id: ADMIN_ID },
      error: null,
    });
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ maybeSingle })),
        })),
      })),
    } as never;

    await expect(hasKecoAdminAccess(ADMIN_ID, supabase)).resolves.toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('keco_admin_users');
  });

  it('falls back to the configured legacy admin when the table has no row', async () => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
    } as never;

    await expect(hasKecoAdminAccess(ADMIN_ID, supabase, ADMIN_ID)).resolves.toBe(true);
  });

  it('fails closed when the admin table query errors', async () => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: null,
              error: new Error('database unavailable'),
            }),
          })),
        })),
      })),
    } as never;

    await expect(
      hasKecoAdminAccess('11111111-1111-4111-8111-111111111111', supabase, undefined),
    ).resolves.toBe(false);
  });
});
