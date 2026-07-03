-- Atomic skill reset: refund spent SP and clear the skill level in one transaction.
-- Mirrors sim_upgrade_skill (security definer, own-user only) so reset is transaction-safe
-- instead of relying on the non-atomic client-side table fallback.
create or replace function public.sim_reset_skill(p_skill_id text)
returns public.sim_user_skill_levels
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prog public.sim_user_progression;
  v_existing public.sim_user_skill_levels;
  v_reset public.sim_user_skill_levels;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_skill_id is null or btrim(p_skill_id) = '' then
    raise exception 'invalid skill';
  end if;

  select * into v_prog from sim_user_progression where user_id = v_uid for update;
  if not found then
    raise exception 'user progression row not found';
  end if;

  select * into v_existing
    from sim_user_skill_levels
    where user_id = v_uid and skill_id = p_skill_id
    for update;

  if found then
    update sim_user_progression
      set skill_points = skill_points + v_existing.spent_sp,
          updated_at = now()
      where user_id = v_uid;

    delete from sim_user_skill_levels
      where user_id = v_uid and skill_id = p_skill_id;
  end if;

  v_reset.user_id := v_uid;
  v_reset.skill_id := p_skill_id;
  v_reset.level := 0;
  v_reset.spent_sp := 0;
  return v_reset;
end;
$$;

revoke all on function public.sim_reset_skill(text) from public;
grant execute on function public.sim_reset_skill(text) to authenticated;

notify pgrst, 'reload schema';
