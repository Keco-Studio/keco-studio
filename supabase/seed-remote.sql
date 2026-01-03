-- Seed data for remote Supabase testing
-- This version dynamically gets the instance_id instead of using hardcoded local value
-- Multiple users:
-- 1-4) empty accounts (for parallel testing)
-- 5) account with one empty project
-- 6) account with one project that has one empty library

begin;

-- Get the actual instance_id from the auth.instances table
do $$
declare
  v_instance_id uuid;
begin
  -- Get the instance_id (should be only one for a Supabase project)
  select id into v_instance_id from auth.instances limit 1;
  
  if v_instance_id is null then
    raise exception 'Could not find instance_id in auth.instances';
  end if;

  -- User 1: empty account
  if not exists (select 1 from auth.users where email = 'seed-empty@mailinator.com') then
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
      v_instance_id,
      'seed-empty@mailinator.com',
      u.enc_pwd,
      jsonb_build_object('provider', 'email', 'providers', array['email']),
      jsonb_build_object('username', 'seed-empty'),
      now(), now(),
      'authenticated', 'authenticated',
      now(), now(), now(),
      '', '', '', '', '', ''
    from u;
  end if;

  -- User 2: empty account (for parallel testing)
  if not exists (select 1 from auth.users where email = 'seed-empty-2@mailinator.com') then
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
      v_instance_id,
      'seed-empty-2@mailinator.com',
      u.enc_pwd,
      jsonb_build_object('provider', 'email', 'providers', array['email']),
      jsonb_build_object('username', 'seed-empty-2'),
      now(), now(),
      'authenticated', 'authenticated',
      now(), now(), now(),
      '', '', '', '', '', ''
    from u;
  end if;

  -- User 3: empty account (for parallel testing)
  if not exists (select 1 from auth.users where email = 'seed-empty-3@mailinator.com') then
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
      v_instance_id,
      'seed-empty-3@mailinator.com',
      u.enc_pwd,
      jsonb_build_object('provider', 'email', 'providers', array['email']),
      jsonb_build_object('username', 'seed-empty-3'),
      now(), now(),
      'authenticated', 'authenticated',
      now(), now(), now(),
      '', '', '', '', '', ''
    from u;
  end if;

  -- User 4: empty account (for parallel testing)
  if not exists (select 1 from auth.users where email = 'seed-empty-4@mailinator.com') then
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
      v_instance_id,
      'seed-empty-4@mailinator.com',
      u.enc_pwd,
      jsonb_build_object('provider', 'email', 'providers', array['email']),
      jsonb_build_object('username', 'seed-empty-4'),
      now(), now(),
      'authenticated', 'authenticated',
      now(), now(), now(),
      '', '', '', '', '', ''
    from u;
  end if;

  -- User 5: has one empty project
  declare
    v_user5_id uuid;
  begin
    -- Get or create user
    select id into v_user5_id from auth.users where email = 'seed-project@mailinator.com';
    
    if v_user5_id is null then
      insert into auth.users (
        id, instance_id, email, encrypted_password,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, aud, role,
        email_confirmed_at, confirmation_sent_at, last_sign_in_at,
        confirmation_token, recovery_token, email_change_token_new,
        email_change_token_current, email_change, reauthentication_token
      )
      values (
        gen_random_uuid(),
        v_instance_id,
        'seed-project@mailinator.com',
        crypt('Password123!', gen_salt('bf')),
        jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('username', 'seed-project'),
        now(), now(),
        'authenticated', 'authenticated',
        now(), now(), now(),
        '', '', '', '', '', ''
      )
      returning id into v_user5_id;
    end if;
    
    -- Create project if it doesn't exist
    if not exists (
      select 1 from public.projects 
      where owner_id = v_user5_id 
      and name = 'Seed Project A'
    ) then
      insert into public.projects (owner_id, name, description)
      values (v_user5_id, 'Seed Project A', 'Empty project for seeds');
    end if;
  end;

  -- User 6: has one project with one empty library
  declare
    v_user6_id uuid;
    v_project6_id uuid;
  begin
    -- Get or create user
    select id into v_user6_id from auth.users where email = 'seed-library@mailinator.com';
    
    if v_user6_id is null then
      insert into auth.users (
        id, instance_id, email, encrypted_password,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, aud, role,
        email_confirmed_at, confirmation_sent_at, last_sign_in_at,
        confirmation_token, recovery_token, email_change_token_new,
        email_change_token_current, email_change, reauthentication_token
      )
      values (
        gen_random_uuid(),
        v_instance_id,
        'seed-library@mailinator.com',
        crypt('Password123!', gen_salt('bf')),
        jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('username', 'seed-library'),
        now(), now(),
        'authenticated', 'authenticated',
        now(), now(), now(),
        '', '', '', '', '', ''
      )
      returning id into v_user6_id;
    end if;
    
    -- Get or create project
    select id into v_project6_id from public.projects 
    where owner_id = v_user6_id and name = 'Seed Project B';
    
    if v_project6_id is null then
      insert into public.projects (owner_id, name, description)
      values (v_user6_id, 'Seed Project B', 'Project with one empty library')
      returning id into v_project6_id;
    end if;
    
    -- Create library if it doesn't exist
    if not exists (
      select 1 from public.libraries 
      where project_id = v_project6_id 
      and name = 'Seed Library B1'
    ) then
      insert into public.libraries (project_id, name, description)
      values (v_project6_id, 'Seed Library B1', 'Empty library');
    end if;
  end;

  -- ==========================================
  -- Destructive Test Users
  -- These accounts have pre-populated data for deletion testing
  -- ==========================================
  
  -- Destructive Test User 1
  declare
    v_destruct_user1_id uuid;
    v_destruct_project1_id uuid;
    v_destruct_folder1_id uuid;
    v_destruct_library1_id uuid;
    v_destruct_library_root1_id uuid;
    v_destruct_asset1_id uuid;
  begin
    -- Get or create user
    select id into v_destruct_user1_id from auth.users 
    where email = 'seed-destruct-1@mailinator.com';
    
    if v_destruct_user1_id is null then
      insert into auth.users (
        instance_id, email, encrypted_password,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, aud, role,
        email_confirmed_at, confirmation_sent_at, last_sign_in_at,
        confirmation_token, recovery_token, email_change_token_new,
        email_change_token_current, email_change, reauthentication_token
      )
      values (
        '00000000-0000-0000-0000-000000000000',
        'seed-destruct-1@mailinator.com',
        crypt('Password123!', gen_salt('bf')),
        jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('username', 'seed-destruct-1'),
        now(), now(),
        'authenticated', 'authenticated',
        now(), now(), now(),
        '', '', '', '', '', ''
      )
      returning id into v_destruct_user1_id;
    end if;
    
    -- Get or create project
    select id into v_destruct_project1_id from public.projects 
    where owner_id = v_destruct_user1_id and name = 'Destruct Test Project 1';
    
    if v_destruct_project1_id is null then
      insert into public.projects (owner_id, name, description)
      values (v_destruct_user1_id, 'Destruct Test Project 1', 'Project for deletion testing')
      returning id into v_destruct_project1_id;
    end if;
    
    -- Get or create folder
    select id into v_destruct_folder1_id from public.folders
    where project_id = v_destruct_project1_id and name = 'Test Folder 1';
    
    if v_destruct_folder1_id is null then
      insert into public.folders (project_id, name, description)
      values (v_destruct_project1_id, 'Test Folder 1', 'Folder for deletion testing')
      returning id into v_destruct_folder1_id;
    end if;
    
    -- Get or create library in folder
    select id into v_destruct_library1_id from public.libraries
    where project_id = v_destruct_project1_id and name = 'Test Library 1';
    
    if v_destruct_library1_id is null then
      insert into public.libraries (project_id, folder_id, name, description)
      values (v_destruct_project1_id, v_destruct_folder1_id, 'Test Library 1', 'Library for deletion testing')
      returning id into v_destruct_library1_id;
      
      -- Add field definitions
      insert into public.library_field_definitions (library_id, label, data_type, section, order_index, required)
      values 
        (v_destruct_library1_id, 'Name', 'string', 'General', 0, true),
        (v_destruct_library1_id, 'Type', 'string', 'General', 1, true),
        (v_destruct_library1_id, 'Description', 'string', 'General', 2, false);
    end if;
    
    -- Get or create root library
    select id into v_destruct_library_root1_id from public.libraries
    where project_id = v_destruct_project1_id and name = 'Root Library 1';
    
    if v_destruct_library_root1_id is null then
      insert into public.libraries (project_id, name, description)
      values (v_destruct_project1_id, 'Root Library 1', 'Root-level library for deletion testing')
      returning id into v_destruct_library_root1_id;
    end if;
    
    -- Create asset if it doesn't exist
    if not exists (
      select 1 from public.library_assets 
      where library_id = v_destruct_library1_id 
      and name = 'Test Asset 1'
    ) then
      insert into public.library_assets (library_id, name)
      values (v_destruct_library1_id, 'Test Asset 1');
    end if;
  end;

  -- Destructive Test User 2
  declare
    v_destruct_user2_id uuid;
    v_destruct_project2_id uuid;
    v_destruct_folder2_id uuid;
    v_destruct_library2_id uuid;
    v_destruct_library_root2_id uuid;
    v_destruct_asset2_id uuid;
  begin
    -- Get or create user
    select id into v_destruct_user2_id from auth.users 
    where email = 'seed-destruct-2@mailinator.com';
    
    if v_destruct_user2_id is null then
      insert into auth.users (
        instance_id, email, encrypted_password,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, aud, role,
        email_confirmed_at, confirmation_sent_at, last_sign_in_at,
        confirmation_token, recovery_token, email_change_token_new,
        email_change_token_current, email_change, reauthentication_token
      )
      values (
        '00000000-0000-0000-0000-000000000000',
        'seed-destruct-2@mailinator.com',
        crypt('Password123!', gen_salt('bf')),
        jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('username', 'seed-destruct-2'),
        now(), now(),
        'authenticated', 'authenticated',
        now(), now(), now(),
        '', '', '', '', '', ''
      )
      returning id into v_destruct_user2_id;
    end if;
    
    -- Get or create project
    select id into v_destruct_project2_id from public.projects 
    where owner_id = v_destruct_user2_id and name = 'Destruct Test Project 2';
    
    if v_destruct_project2_id is null then
      insert into public.projects (owner_id, name, description)
      values (v_destruct_user2_id, 'Destruct Test Project 2', 'Project for deletion testing')
      returning id into v_destruct_project2_id;
    end if;
    
    -- Get or create folder
    select id into v_destruct_folder2_id from public.folders
    where project_id = v_destruct_project2_id and name = 'Test Folder 2';
    
    if v_destruct_folder2_id is null then
      insert into public.folders (project_id, name, description)
      values (v_destruct_project2_id, 'Test Folder 2', 'Folder for deletion testing')
      returning id into v_destruct_folder2_id;
    end if;
    
    -- Get or create library in folder
    select id into v_destruct_library2_id from public.libraries
    where project_id = v_destruct_project2_id and name = 'Test Library 2';
    
    if v_destruct_library2_id is null then
      insert into public.libraries (project_id, folder_id, name, description)
      values (v_destruct_project2_id, v_destruct_folder2_id, 'Test Library 2', 'Library for deletion testing')
      returning id into v_destruct_library2_id;
      
      -- Add field definitions
      insert into public.library_field_definitions (library_id, label, data_type, section, order_index, required)
      values 
        (v_destruct_library2_id, 'Name', 'string', 'General', 0, true),
        (v_destruct_library2_id, 'Type', 'string', 'General', 1, true),
        (v_destruct_library2_id, 'Description', 'string', 'General', 2, false);
    end if;
    
    -- Get or create root library
    select id into v_destruct_library_root2_id from public.libraries
    where project_id = v_destruct_project2_id and name = 'Root Library 2';
    
    if v_destruct_library_root2_id is null then
      insert into public.libraries (project_id, name, description)
      values (v_destruct_project2_id, 'Root Library 2', 'Root-level library for deletion testing')
      returning id into v_destruct_library_root2_id;
    end if;
    
    -- Create asset if it doesn't exist
    if not exists (
      select 1 from public.library_assets 
      where library_id = v_destruct_library2_id 
      and name = 'Test Asset 2'
    ) then
      insert into public.library_assets (library_id, name)
      values (v_destruct_library2_id, 'Test Asset 2');
    end if;
  end;

end $$;

commit;

