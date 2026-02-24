-- Update handle_new_user to copy username from auth.users.raw_user_meta_data
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, username, created_at, updated_at)
  values (
    new.id,
    new.email,
    coalesce((new.raw_user_meta_data->>'username'), null),
    now(),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    username = excluded.username,
    updated_at = now();

  return new;
end;
$$ language plpgsql security definer;

-- Backfill existing profiles username from auth.users meta if missing
update public.profiles p
set username = coalesce(p.username, u.raw_user_meta_data->>'username')
from auth.users u
where p.id = u.id
  and (p.username is null or p.username = '');
