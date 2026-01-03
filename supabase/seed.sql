-- Seed data for local testing
-- Multiple users:
-- 1-4) empty accounts (for parallel testing)
-- 5) account with one empty project
-- 6) account with one project that has one empty library
--
-- Note: Using @mailinator.com for consistency with CI environment.
-- Local Supabase allows any email domain, but we use mailinator.com
-- to match the remote seed configuration.

begin;

-- Helper to create a user with a known password.
-- Supabase's local auth schema uses `encrypted_password` (bcrypt).
-- The instance_id for local projects is all zeros.

-- User 1: empty account
with u as (
  select
    gen_random_uuid() as id,
    crypt('Password123!', gen_salt('bf')) as enc_pwd
)
insert into auth.users (
  id, instance_id, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, aud, role,
  email_confirmed_at, confirmation_sent_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, email_change, reauthentication_token
)
select
  u.id,
  '00000000-0000-0000-0000-000000000000',
  'seed-empty@mailinator.com',
  u.enc_pwd,
  jsonb_build_object('provider', 'email', 'providers', array['email']),
  jsonb_build_object('username', 'seed-empty'),
  now(), now(),
  'authenticated', 'authenticated',
  now(), now(), now(),
  '', '', '', '', '', ''
from u;

-- User 2: empty account (for parallel testing)
with u as (
  select
    gen_random_uuid() as id,
    crypt('Password123!', gen_salt('bf')) as enc_pwd
)
insert into auth.users (
  id, instance_id, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, aud, role,
  email_confirmed_at, confirmation_sent_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, email_change, reauthentication_token
)
select
  u.id,
  '00000000-0000-0000-0000-000000000000',
  'seed-empty-2@mailinator.com',
  u.enc_pwd,
  jsonb_build_object('provider', 'email', 'providers', array['email']),
  jsonb_build_object('username', 'seed-empty-2'),
  now(), now(),
  'authenticated', 'authenticated',
  now(), now(), now(),
  '', '', '', '', '', ''
from u;

-- User 3: empty account (for parallel testing)
with u as (
  select
    gen_random_uuid() as id,
    crypt('Password123!', gen_salt('bf')) as enc_pwd
)
insert into auth.users (
  id, instance_id, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, aud, role,
  email_confirmed_at, confirmation_sent_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, email_change, reauthentication_token
)
select
  u.id,
  '00000000-0000-0000-0000-000000000000',
  'seed-empty-3@mailinator.com',
  u.enc_pwd,
  jsonb_build_object('provider', 'email', 'providers', array['email']),
  jsonb_build_object('username', 'seed-empty-3'),
  now(), now(),
  'authenticated', 'authenticated',
  now(), now(), now(),
  '', '', '', '', '', ''
from u;

-- User 4: empty account (for parallel testing)
with u as (
  select
    gen_random_uuid() as id,
    crypt('Password123!', gen_salt('bf')) as enc_pwd
)
insert into auth.users (
  id, instance_id, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, aud, role,
  email_confirmed_at, confirmation_sent_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, email_change, reauthentication_token
)
select
  u.id,
  '00000000-0000-0000-0000-000000000000',
  'seed-empty-4@mailinator.com',
  u.enc_pwd,
  jsonb_build_object('provider', 'email', 'providers', array['email']),
  jsonb_build_object('username', 'seed-empty-4'),
  now(), now(),
  'authenticated', 'authenticated',
  now(), now(), now(),
  '', '', '', '', '', ''
from u;

-- User 2: has one empty project
with user2 as (
  insert into auth.users (
    id, instance_id, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role,
    email_confirmed_at, confirmation_sent_at, last_sign_in_at,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change, reauthentication_token
  )
  select
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    'seed-project@mailinator.com',
    crypt('Password123!', gen_salt('bf')),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('username', 'seed-project'),
    now(), now(),
    'authenticated', 'authenticated',
    now(), now(), now(),
    '', '', '', '', '', ''
  returning id
)
insert into public.projects (owner_id, name, description)
select id, 'Seed Project A', 'Empty project for seeds'
from user2;

-- User 3: has one project with one empty library
with user3 as (
  insert into auth.users (
    id, instance_id, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role,
    email_confirmed_at, confirmation_sent_at, last_sign_in_at,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change, reauthentication_token
  )
  select
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    'seed-library@mailinator.com',
    crypt('Password123!', gen_salt('bf')),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('username', 'seed-library'),
    now(), now(),
    'authenticated', 'authenticated',
    now(), now(), now(),
    '', '', '', '', '', ''
  returning id
),
project3 as (
  insert into public.projects (owner_id, name, description)
  select id, 'Seed Project B', 'Project with one empty library'
  from user3
  returning id
)
insert into public.libraries (project_id, name, description)
select id, 'Seed Library B1', 'Empty library'
from project3;

-- ==========================================
-- Destructive Test Users
-- These accounts have pre-populated data for deletion testing
-- ==========================================

-- Destructive Test User 1: Complete test data (project → folder → library → asset)
with destruct_user1 as (
  insert into auth.users (
    id, instance_id, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role,
    email_confirmed_at, confirmation_sent_at, last_sign_in_at,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change, reauthentication_token
  )
  select
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    'seed-destruct-1@mailinator.com',
    crypt('Password123!', gen_salt('bf')),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('username', 'seed-destruct-1'),
    now(), now(),
    'authenticated', 'authenticated',
    now(), now(), now(),
    '', '', '', '', '', ''
  returning id
),
destruct_project1 as (
  insert into public.projects (owner_id, name, description)
  select id, 'Destruct Test Project 1', 'Project for deletion testing'
  from destruct_user1
  returning id, owner_id
),
destruct_folder1 as (
  insert into public.folders (project_id, name, description)
  select id, 'Test Folder 1', 'Folder for deletion testing'
  from destruct_project1
  returning id, project_id
),
destruct_library1 as (
  insert into public.libraries (project_id, folder_id, name, description)
  select p.id, f.id, 'Test Library 1', 'Library for deletion testing'
  from destruct_project1 p, destruct_folder1 f
  returning id, project_id
),
destruct_library_root1 as (
  insert into public.libraries (project_id, name, description)
  select id, 'Root Library 1', 'Root-level library for deletion testing'
  from destruct_project1
  returning id, project_id
),
destruct_asset1 as (
  insert into public.library_assets (library_id, name)
  select id, 'Test Asset 1'
  from destruct_library1
  returning id, library_id
)
-- Add field definitions for the library (simple schema)
insert into public.library_field_definitions (library_id, label, data_type, section, order_index, required)
select 
  l.id,
  unnest(array['Name', 'Type', 'Description']),
  unnest(array['string', 'string', 'string']),
  'General',
  unnest(array[0, 1, 2]),
  unnest(array[true, true, false])
from destruct_library1 l;

-- Destructive Test User 2: Another complete test data set
with destruct_user2 as (
  insert into auth.users (
    id, instance_id, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role,
    email_confirmed_at, confirmation_sent_at, last_sign_in_at,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change, reauthentication_token
  )
  select
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    'seed-destruct-2@mailinator.com',
    crypt('Password123!', gen_salt('bf')),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('username', 'seed-destruct-2'),
    now(), now(),
    'authenticated', 'authenticated',
    now(), now(), now(),
    '', '', '', '', '', ''
  returning id
),
destruct_project2 as (
  insert into public.projects (owner_id, name, description)
  select id, 'Destruct Test Project 2', 'Project for deletion testing'
  from destruct_user2
  returning id, owner_id
),
destruct_folder2 as (
  insert into public.folders (project_id, name, description)
  select id, 'Test Folder 2', 'Folder for deletion testing'
  from destruct_project2
  returning id, project_id
),
destruct_library2 as (
  insert into public.libraries (project_id, folder_id, name, description)
  select p.id, f.id, 'Test Library 2', 'Library for deletion testing'
  from destruct_project2 p, destruct_folder2 f
  returning id, project_id
),
destruct_library_root2 as (
  insert into public.libraries (project_id, name, description)
  select id, 'Root Library 2', 'Root-level library for deletion testing'
  from destruct_project2
  returning id, project_id
),
destruct_asset2 as (
  insert into public.library_assets (library_id, name)
  select id, 'Test Asset 2'
  from destruct_library2
  returning id, library_id
)
-- Add field definitions for the library (simple schema)
insert into public.library_field_definitions (library_id, label, data_type, section, order_index, required)
select 
  l.id,
  unnest(array['Name', 'Type', 'Description']),
  unnest(array['string', 'string', 'string']),
  'General',
  unnest(array[0, 1, 2]),
  unnest(array[true, true, false])
from destruct_library2 l;

commit;

