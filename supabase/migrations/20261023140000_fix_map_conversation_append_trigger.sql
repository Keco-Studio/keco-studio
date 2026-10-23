-- The GDD conversation binding appends several historical Plans in sequence.
-- Permit only that counter append while comparing every immutable header field
-- structurally, including the new GDD job origin.

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
