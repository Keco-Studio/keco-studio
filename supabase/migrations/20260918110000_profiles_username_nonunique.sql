-- Usernames are display names and may be shared by multiple accounts.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_key;

DROP INDEX IF EXISTS public.idx_profiles_username;

CREATE INDEX IF NOT EXISTS idx_profiles_username
  ON public.profiles (username);
