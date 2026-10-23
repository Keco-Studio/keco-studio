-- PostgreSQL exposes TG_OP as uppercase. The append-only header trigger must
-- recognize UPDATE so legitimate Plan-version increments are not rejected.

create or replace function public.prevent_map_conversation_header_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.next_plan_display_version > old.next_plan_display_version
    and (pg_catalog.to_jsonb(new) - 'next_plan_display_version')
      = (pg_catalog.to_jsonb(old) - 'next_plan_display_version') then
    return new;
  end if;
  raise exception 'map conversation records are immutable' using errcode = '23514';
end;
$$;

notify pgrst, 'reload schema';
