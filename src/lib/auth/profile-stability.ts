import type { UserProfile } from '@/lib/types/user';

const PROFILE_KEYS: Array<keyof UserProfile> = [
  'id',
  'email',
  'username',
  'full_name',
  'avatar_url',
  'created_at',
  'updated_at',
];

export function areUserProfilesEqual(
  currentProfile: UserProfile | null,
  nextProfile: UserProfile | null
): boolean {
  if (currentProfile === nextProfile) return true;
  if (!currentProfile || !nextProfile) return false;
  return PROFILE_KEYS.every((key) => currentProfile[key] === nextProfile[key]);
}

export function shouldFetchUserProfileForAuthEvent(
  event: string,
  sessionUserId: string,
  currentUserId: string | null,
  loadedProfileUserId: string | null
): boolean {
  const isRoutineSameUserEvent = event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED';
  return !(
    isRoutineSameUserEvent &&
    currentUserId === sessionUserId &&
    loadedProfileUserId === sessionUserId
  );
}
