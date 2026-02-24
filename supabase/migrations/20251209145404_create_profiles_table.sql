-- Create profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  email text,
  avatar_url text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for query performance
create index if not exists idx_profiles_email on public.profiles (email);
create unique index if not exists idx_profiles_username on public.profiles (username);

-- Update updated_at automatically
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.update_updated_at_column();

-- Function to handle new auth.users insert
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, created_at, updated_at)
  values (new.id, new.email, now(), now())
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Helper functions for username/email lookup
create or replace function public.get_user_by_username(p_username text)
returns table (
  id uuid,
  email text,
  username text,
  full_name text,
  avatar_url text
) as $$
  select u.id, u.email, p.username, p.full_name, p.avatar_url
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.username = p_username;
$$ language sql stable;

create or replace function public.get_user_by_email_or_username(identifier text)
returns table (
  id uuid,
  email text,
  username text,
  full_name text,
  avatar_url text
) as $$
  select u.id, u.email, p.username, p.full_name, p.avatar_url
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.email = identifier or p.username = identifier;
$$ language sql stable;

-- Enable RLS
alter table public.profiles enable row level security;

-- RLS policies
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public on public.profiles
  for select using (true);

