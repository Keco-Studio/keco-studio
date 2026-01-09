-- Migration: Auto-add project owner as admin collaborator
-- Purpose: Automatically add project creator as admin when project is created
-- Feature: Real-time Project Collaboration

-- Drop existing function to allow modification
DROP FUNCTION IF EXISTS public.create_project_with_default_resource(text, text);

-- Recreate function with auto-add collaborator logic
CREATE OR REPLACE FUNCTION public.create_project_with_default_resource(
  p_name text,
  p_description text default null
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_folder_id uuid;
  v_user uuid := auth.uid();
  v_name text := trim(p_name);
  v_description text := nullif(trim(p_description), '');
  v_result json;
  v_user_email text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: auth.uid() is null';
  END IF;
  IF v_name IS NULL OR length(v_name) = 0 THEN
    RAISE EXCEPTION 'Project name required';
  END IF;

  -- Ensure profile exists for the current user
  -- Get email from auth.users
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user;
  
  -- Insert profile if it doesn't exist (using on conflict to handle race conditions)
  INSERT INTO public.profiles (id, email, created_at, updated_at)
  VALUES (v_user, v_user_email, now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- Create project
  INSERT INTO public.projects (owner_id, name, description)
  VALUES (v_user, v_name, v_description)
  RETURNING id INTO v_project_id;

  -- Create default Resources Folder and get its ID
  INSERT INTO public.folders (project_id, name, description)
  VALUES (v_project_id, 'Resources Folder', 'Default resources folder')
  RETURNING id INTO v_folder_id;

  -- Auto-add project owner as admin collaborator
  INSERT INTO public.project_collaborators (
    user_id,
    project_id,
    role,
    invited_by,
    invited_at,
    accepted_at
  ) VALUES (
    v_user,
    v_project_id,
    'admin',
    NULL,  -- Self-added (owner)
    now(),
    now()  -- Auto-accepted
  )
  ON CONFLICT (user_id, project_id) DO NOTHING;

  -- Return as JSON object
  v_result := json_build_object(
    'project_id', v_project_id,
    'folder_id', v_folder_id
  );

  RETURN v_result;
END;
$$;

-- Add comment
COMMENT ON FUNCTION public.create_project_with_default_resource(text, text) 
IS 'Creates a project with default Resources folder and auto-adds owner as admin collaborator';

