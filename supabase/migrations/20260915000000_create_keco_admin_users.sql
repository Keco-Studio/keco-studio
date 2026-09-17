-- Database-backed allowlist for account-level Keco Admin access.
-- The legacy KECO_ADMIN_USER_ID environment variable remains a temporary
-- compatibility fallback in application code during rollout.

create table if not exists public.keco_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.keco_admin_users is
  'Supabase Auth users allowed to access the account-level Keco Admin workspace.';

alter table public.keco_admin_users enable row level security;

revoke all on table public.keco_admin_users from public, anon;
grant select on table public.keco_admin_users to authenticated;
grant all on table public.keco_admin_users to service_role;

drop policy if exists "keco_admin_users_self_select" on public.keco_admin_users;
create policy "keco_admin_users_self_select"
  on public.keco_admin_users
  for select
  to authenticated
  using (user_id = (select auth.uid()));

comment on policy "keco_admin_users_self_select" on public.keco_admin_users is
  'An authenticated user may only check whether their own Auth UUID is allowlisted.';
