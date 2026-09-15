-- Make the current Supabase Auth email the sole account-email authority.

do $$
begin
  if exists (
    select 1
    from auth.users
    where email is not null
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception
      'duplicate normalized auth email groups must be resolved before applying current email identity';
  end if;
end
$$;

-- Repair the denormalized profile copy before enforcing its uniqueness.
update public.profiles as profile
set
  email = lower(btrim(auth_user.email)),
  updated_at = now()
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.email is distinct from lower(btrim(auth_user.email));

create unique index if not exists profiles_current_email_normalized_key
  on public.profiles (lower(btrim(email)))
  where email is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    email,
    username,
    created_at,
    updated_at
  )
  values (
    new.id,
    lower(btrim(new.email)),
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    now(),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_new_user();

-- Profiles may update their display fields, but email is projected from Auth.
revoke update on table public.profiles from anon, authenticated;
grant update (username, avatar_url, full_name, avatar_color)
  on table public.profiles to authenticated;

comment on index profiles_current_email_normalized_key is
  'Keeps the synchronized profile email copy unambiguous.';

comment on function public.handle_new_user() is
  'Creates profiles and synchronizes their email from the authoritative Auth user.';
