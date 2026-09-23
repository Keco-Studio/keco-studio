-- Reload PostgREST for projects where the atomic webhook migration was already applied.
NOTIFY pgrst, 'reload schema';
