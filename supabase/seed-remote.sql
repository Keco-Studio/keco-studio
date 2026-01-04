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
  else
    -- User exists, ensure password is correct
    update auth.users 
    set encrypted_password = crypt('Password123!', gen_salt('bf')),
        updated_at = now()
    where email = 'seed-empty@mailinator.com';
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
  else
    -- User exists, ensure password is correct
    update auth.users 
    set encrypted_password = crypt('Password123!', gen_salt('bf')),
        updated_at = now()
    where email = 'seed-empty-2@mailinator.com';
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
  else
    -- User exists, ensure password is correct
    update auth.users 
    set encrypted_password = crypt('Password123!', gen_salt('bf')),
        updated_at = now()
    where email = 'seed-empty-3@mailinator.com';
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
  else
    -- User exists, ensure password is correct
    update auth.users 
    set encrypted_password = crypt('Password123!', gen_salt('bf')),
        updated_at = now()
    where email = 'seed-empty-4@mailinator.com';
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
    else
      -- User exists, ensure password is correct
      update auth.users 
      set encrypted_password = crypt('Password123!', gen_salt('bf')),
          updated_at = now()
      where id = v_user5_id;
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
    else
      -- User exists, ensure password is correct
      update auth.users 
      set encrypted_password = crypt('Password123!', gen_salt('bf')),
          updated_at = now()
      where id = v_user6_id;
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
  -- Happy Path Test User
  -- This account has pre-populated data matching what happy-path.spec.ts creates
  -- Used by destructive.spec.ts for deletion testing
  -- ==========================================
  
  -- User 7: Happy Path Test User (using same pattern as User 1-4 for user creation)
  if not exists (select 1 from auth.users where email = 'seed-happy-path@mailinator.com') then
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
      'seed-happy-path@mailinator.com',
      u.enc_pwd,
      jsonb_build_object('provider', 'email', 'providers', array['email']),
      jsonb_build_object('username', 'seed-happy-path'),
      now(), now(),
      'authenticated', 'authenticated',
      now(), now(), now(),
      '', '', '', '', '', ''
    from u;
  else
    -- User exists, ensure password is correct
    update auth.users 
    set encrypted_password = crypt('Password123!', gen_salt('bf')),
        updated_at = now()
    where email = 'seed-happy-path@mailinator.com';
  end if;
  
  -- Create happy path user's data (project, folders, libraries, assets)
  declare
    v_happy_user_id uuid;
    v_happy_project_id uuid;
    v_happy_breed_library_id uuid;
    v_happy_breed_name_field_id uuid;
    v_happy_breed_origin_field_id uuid;
    v_happy_breed_asset_id uuid;
  begin
    -- Get the user ID
    select id into v_happy_user_id from auth.users 
    where email = 'seed-happy-path@mailinator.com';
    
    -- Get or create project
    select id into v_happy_project_id from public.projects 
    where owner_id = v_happy_user_id and name = 'Livestock Management Project';
    
    if v_happy_project_id is null then
      insert into public.projects (owner_id, name, description)
      values (v_happy_user_id, 'Livestock Management Project', 'End-to-end test project for livestock asset management')
      returning id into v_happy_project_id;
    end if;
    
    -- Create direct folder if it doesn't exist
    if not exists (
      select 1 from public.folders 
      where project_id = v_happy_project_id 
      and name = 'Direct Folder'
    ) then
      insert into public.folders (project_id, name, description)
      values (v_happy_project_id, 'Direct Folder', 'Folder created directly under project');
    end if;
    
    -- Get or create breed library
    select id into v_happy_breed_library_id from public.libraries
    where project_id = v_happy_project_id and name = 'Breed Library';
    
    if v_happy_breed_library_id is null then
      insert into public.libraries (project_id, name, description)
      values (v_happy_project_id, 'Breed Library', 'Reference library for livestock breeds')
      returning id into v_happy_breed_library_id;
    end if;
    
    -- Get or create field definitions
    select id into v_happy_breed_name_field_id from public.library_field_definitions
    where library_id = v_happy_breed_library_id and label = 'name';
    
    if v_happy_breed_name_field_id is null then
      insert into public.library_field_definitions (library_id, label, data_type, section, order_index, required)
      values (v_happy_breed_library_id, 'name', 'string', 'Basic Information', 0, true)
      returning id into v_happy_breed_name_field_id;
    end if;
    
    select id into v_happy_breed_origin_field_id from public.library_field_definitions
    where library_id = v_happy_breed_library_id and label = 'Origin';
    
    if v_happy_breed_origin_field_id is null then
      insert into public.library_field_definitions (library_id, label, data_type, section, order_index, required)
      values (v_happy_breed_library_id, 'Origin', 'string', 'Basic Information', 1, false)
      returning id into v_happy_breed_origin_field_id;
    end if;
    
    -- Get or create breed asset
    select id into v_happy_breed_asset_id from public.library_assets
    where library_id = v_happy_breed_library_id and name = 'Black Goat Breed';
    
    if v_happy_breed_asset_id is null then
      insert into public.library_assets (library_id, name)
      values (v_happy_breed_library_id, 'Black Goat Breed')
      returning id into v_happy_breed_asset_id;
    end if;
    
    -- Insert or update field values for the breed asset
    insert into public.library_asset_values (asset_id, field_id, value_json)
    values (v_happy_breed_asset_id, v_happy_breed_name_field_id, '"Black Goat Breed"'::jsonb)
    on conflict (asset_id, field_id) do update set value_json = '"Black Goat Breed"'::jsonb;
    
    insert into public.library_asset_values (asset_id, field_id, value_json)
    values (v_happy_breed_asset_id, v_happy_breed_origin_field_id, '"African Highlands"'::jsonb)
    on conflict (asset_id, field_id) do update set value_json = '"African Highlands"'::jsonb;
    
    -- Create direct library if it doesn't exist
    if not exists (
      select 1 from public.libraries 
      where project_id = v_happy_project_id 
      and name = 'Direct Library'
    ) then
      insert into public.libraries (project_id, name, description)
      values (v_happy_project_id, 'Direct Library', 'Library created directly under project');
    end if;
  end;

end $$;

commit;

