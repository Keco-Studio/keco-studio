import type { UserProfile } from '@/lib/types/user';

export const PROFILE_FETCH_RETRY_LIMIT = 2;

/** Network failures are represented by PostgREST as a status-0 response. */
export function shouldRetryProfileFetch(response: unknown, attempt: number): boolean {
  if (attempt >= PROFILE_FETCH_RETRY_LIMIT || !response || typeof response !== 'object') {
    return false;
  }

  const candidate = response as { status?: unknown; error?: unknown };
  if (candidate.status !== 0) return false;

  const error = candidate.error;
  if (!error || typeof error !== 'object') return false;
  const messageCandidate = (error as { message?: unknown }).message;
  const message = typeof messageCandidate === 'string' ? messageCandidate : '';
  return /failed to fetch|networkerror|load failed/i.test(message);
}

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
