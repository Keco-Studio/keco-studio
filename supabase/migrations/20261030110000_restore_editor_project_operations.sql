-- Project Foundation made the four Foundation fields admin-only, but the
-- project row also stores operational flags that editors must still update.
-- Restore the established admin/editor row policy and enforce the narrower
-- Foundation permission at the column-change boundary.

drop policy if exists projects_update_policy on public.projects;
drop policy if exists "projects_update_policy" on public.projects;

create policy "projects_update_policy"
  on public.projects for update
  using (public.is_editor_or_admin_collaborator(id, (select auth.uid())))
  with check (public.is_editor_or_admin_collaborator(id, (select auth.uid())));

create or replace function public.projects_guard_foundation_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
    and not public.is_project_admin_collaborator(old.id, auth.uid())
    and (
      new.name is distinct from old.name
      or new.description is distinct from old.description
      or new.genres is distinct from old.genres
      or new.design_philosophies is distinct from old.design_philosophies
    )
  then
    raise exception 'Only project administrators can update project Foundation fields'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_guard_foundation_updates on public.projects;
create trigger projects_guard_foundation_updates
  before update of name, description, genres, design_philosophies on public.projects
  for each row execute function public.projects_guard_foundation_updates();

comment on policy "projects_update_policy" on public.projects is
  'Admin/editor collaborators can update project rows; a trigger restricts Foundation fields to admins';
