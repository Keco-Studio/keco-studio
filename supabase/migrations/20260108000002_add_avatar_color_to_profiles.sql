-- Migration: Add avatar_color to profiles
-- Purpose: Support deterministic color assignment for presence indicators
-- Feature: Real-time Project Collaboration

-- Add avatar_color column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_color TEXT DEFAULT NULL;

-- Helper function for color generation
CREATE OR REPLACE FUNCTION public.generate_avatar_color(user_id UUID)
RETURNS TEXT AS $$
DECLARE
  hash INTEGER;
  hue INTEGER;
BEGIN
  -- Simple hash of UUID to get consistent color
  -- Extract first 8 characters, convert to integer
  hash := ABS(('x' || SUBSTRING(user_id::TEXT, 1, 8))::BIT(32)::INTEGER);
  hue := (hash % 12) * 30; -- 0, 30, 60, ..., 330 (12 distinct hues)
  RETURN 'hsl(' || hue || ', 70%, 60%)';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill existing users with generated colors
UPDATE public.profiles
SET avatar_color = public.generate_avatar_color(id)
WHERE avatar_color IS NULL;

-- Trigger function to auto-generate color for new users
CREATE OR REPLACE FUNCTION public.set_avatar_color_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.avatar_color IS NULL THEN
    NEW.avatar_color := public.generate_avatar_color(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new user color assignment
DROP TRIGGER IF EXISTS profiles_set_avatar_color ON public.profiles;
CREATE TRIGGER profiles_set_avatar_color
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_avatar_color_on_insert();

-- Comments
COMMENT ON COLUMN public.profiles.avatar_color IS 'HSL color string for consistent user identity in presence indicators, auto-generated on insert';
COMMENT ON FUNCTION public.generate_avatar_color(UUID) IS 'Generates deterministic HSL color from user ID using hash function (12 hues at 30° intervals)';

