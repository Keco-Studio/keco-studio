jest.mock('server-only', () => ({}));

import { isKecoAdminUser } from '@/lib/server/kecoAdminAuthorization';

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
});
