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
-- Happy Path Test User
-- This account has pre-populated data matching what happy-path.spec.ts creates
-- Used by destructive.spec.ts for deletion testing
-- ==========================================

-- Happy Path Test User: Complete data matching happy-path test output
with happy_path_user as (
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
    'seed-happy-path@mailinator.com',
    crypt('Password123!', gen_salt('bf')),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('username', 'seed-happy-path'),
    now(), now(),
    'authenticated', 'authenticated',
    now(), now(), now(),
    '', '', '', '', '', ''
  returning id
),
happy_path_project as (
  insert into public.projects (owner_id, name, description)
  select id, 'Livestock Management Project', 'End-to-end test project for livestock asset management'
  from happy_path_user
  returning id, owner_id
),
happy_path_direct_folder as (
  insert into public.folders (project_id, name, description)
  select id, 'Direct Folder', 'Folder created directly under project'
  from happy_path_project
  returning id, project_id
),
happy_path_breed_library as (
  -- Breed Library (created at project root level, matching happy-path test behavior)
  insert into public.libraries (project_id, name, description)
  select id, 'Breed Library', 'Reference library for livestock breeds'
  from happy_path_project
  returning id, project_id
),
happy_path_breed_field_def as (
  -- Add field definitions for Breed Template
  -- Section: "Basic Information"
  -- Note: First field is always "Name" (auto-created, label='name', data_type='string')
  -- Then: Field "Origin" (string)
  insert into public.library_field_definitions (library_id, label, data_type, section, order_index, required)
  select 
    l.id,
    unnest(array['name', 'Origin']),
    unnest(array['string', 'string']),
    'Basic Information',
    unnest(array[0, 1]),
    unnest(array[true, false])
  from happy_path_breed_library l
  returning id, library_id, label
),
happy_path_breed_asset as (
  insert into public.library_assets (library_id, name)
  select id, 'Black Goat Breed'
  from happy_path_breed_library
  returning id, library_id
),
happy_path_breed_asset_values as (
  -- Insert field values for the breed asset
  -- Name: 'Black Goat Breed' (for the mandatory name field)
  -- Origin: 'African Highlands'
  insert into public.library_asset_values (asset_id, field_id, value_json)
  select 
    a.id,
    fd.id,
    case 
      when fd.label = 'name' then '"Black Goat Breed"'::jsonb
      when fd.label = 'Origin' then '"African Highlands"'::jsonb
    end
  from happy_path_breed_asset a
  join happy_path_breed_library lib on a.library_id = lib.id
  join happy_path_breed_field_def fd on fd.library_id = lib.id
  where fd.label in ('name', 'Origin')
  returning asset_id
),
happy_path_direct_library as (
  insert into public.libraries (project_id, name, description)
  select id, 'Direct Library', 'Library created directly under project'
  from happy_path_project
  returning id, project_id
)
-- All data created successfully
select 1 from happy_path_direct_library;

-- ==========================================
-- File Upload Security Test User
-- This account has a project with a library that has image/file fields
-- Used by file-upload-security.spec.ts and file-upload-security-manual.spec.ts
-- ==========================================

with fileupload_user as (
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
    'seed-fileupload@mailinator.com',
    crypt('Password123!', gen_salt('bf')),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('username', 'seed-fileupload'),
    now(), now(),
    'authenticated', 'authenticated',
    now(), now(), now(),
    '', '', '', '', '', ''
  returning id
),
fileupload_project as (
  insert into public.projects (owner_id, name, description)
  select id, 'File Upload Test Project', 'Project for testing file upload security'
  from fileupload_user
  returning id, owner_id
),
fileupload_library as (
  insert into public.libraries (project_id, name, description)
  select id, 'Media Assets Library', 'Library with image and file fields for upload testing'
  from fileupload_project
  returning id, project_id
),
fileupload_field_definitions as (
  -- Add field definitions with image and file types
  -- Section: "Media"
  -- Fields: name (auto, string), thumbnail (image), document (file), description (string)
  insert into public.library_field_definitions (library_id, label, data_type, section, order_index, required)
  select 
    l.id,
    unnest(array['name', 'thumbnail', 'document', 'description']),
    unnest(array['string', 'image', 'file', 'string']),
    'Media',
    unnest(array[0, 1, 2, 3]),
    unnest(array[true, false, false, false])
  from fileupload_library l
  returning id, library_id, label, data_type
)
-- All data created successfully
select 1 from fileupload_field_definitions;

commit;

