create function public.guard_last_project_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if old.role <> 'admin' or old.accepted_at is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' and new.accepted_at is not null
    and new.project_id = old.project_id then
    return new;
  end if;

  perform 1 from public.projects where id = old.project_id for update;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select count(*) into v_count
  from public.project_collaborators
  where project_id = old.project_id and role = 'admin' and accepted_at is not null;
  if v_count <= 1 then
    raise exception 'Cannot remove the last project admin' using errcode = 'PT409';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger guard_last_project_admin_on_update
before update of role, accepted_at, project_id on public.project_collaborators
for each row execute function public.guard_last_project_admin();

create trigger guard_last_project_admin_on_delete
before delete on public.project_collaborators
for each row execute function public.guard_last_project_admin();

revoke all on function public.guard_last_project_admin() from public, anon, authenticated;
