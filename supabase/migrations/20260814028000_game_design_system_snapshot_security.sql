-- Authenticated clients may read canonical versions but not raw source excerpts.

revoke select on public.game_design_system_versions from authenticated;
grant select (
  id,
  system_id,
  version_number,
  parent_version_id,
  rules,
  rendered_markdown,
  diff,
  conflicts,
  content_hash,
  created_by,
  created_at
) on public.game_design_system_versions to authenticated;

grant select, insert, update, delete on public.game_design_system_versions to service_role;

notify pgrst, 'reload schema';
