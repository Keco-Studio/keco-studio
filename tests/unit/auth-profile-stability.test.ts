import { describe, expect, it } from '@jest/globals';
import {
  areUserProfilesEqual,
  shouldFetchUserProfileForAuthEvent,
} from '@/lib/auth/profile-stability';
import type { UserProfile } from '@/lib/types/user';

const profile: UserProfile = {
  id: 'user-1',
  email: 'user@example.com',
  username: 'user',
  full_name: 'User One',
  avatar_url: null,
  created_at: '2026-07-13T00:00:00.000Z',
  updated_at: '2026-07-13T00:00:00.000Z',
};

describe('auth profile stability', () => {
  it.each(['SIGNED_IN', 'TOKEN_REFRESHED'])(
    'skips profile reload for same-user %s events',
    (event) => {
      expect(
        shouldFetchUserProfileForAuthEvent(event, 'user-1', 'user-1', 'user-1')
      ).toBe(false);
    }
  );

  it('reloads when the user changes, the profile is missing, or profile data may have changed', () => {
    expect(
      shouldFetchUserProfileForAuthEvent('SIGNED_IN', 'user-2', 'user-1', 'user-1')
    ).toBe(true);
    expect(
      shouldFetchUserProfileForAuthEvent('TOKEN_REFRESHED', 'user-1', 'user-1', null)
    ).toBe(true);
    expect(
      shouldFetchUserProfileForAuthEvent('USER_UPDATED', 'user-1', 'user-1', 'user-1')
    ).toBe(true);
  });

  it('recognizes equivalent profile rows without relying on object identity', () => {
    expect(areUserProfilesEqual(profile, { ...profile })).toBe(true);
    expect(
      areUserProfilesEqual(profile, { ...profile, updated_at: '2026-07-13T00:01:00.000Z' })
    ).toBe(false);
    expect(areUserProfilesEqual(profile, null)).toBe(false);
  });
});
