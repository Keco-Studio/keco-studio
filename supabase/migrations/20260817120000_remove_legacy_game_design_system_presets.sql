-- Official Game Design System presets are intentionally unpublished until
-- their product design and canonical rules have been reviewed.

delete from public.project_game_design_systems
where design_system_id in (
  'f0c1d9d4-8f9b-4f4b-9c20-8a11a8e00001',
  'f0c1d9d4-8f9b-4f4b-9c20-8a11a8e00002',
  'f0c1d9d4-8f9b-4f4b-9c20-8a11a8e00003'
);

delete from public.game_design_systems
where id in (
  'f0c1d9d4-8f9b-4f4b-9c20-8a11a8e00001',
  'f0c1d9d4-8f9b-4f4b-9c20-8a11a8e00002',
  'f0c1d9d4-8f9b-4f4b-9c20-8a11a8e00003'
)
and source = 'official';
