-- Migration: Create project_collaborators table
-- Purpose: Junction table representing user-project relationships with role-based permissions
-- Feature: Real-time Project Collaboration

-- Create the table
CREATE TABLE IF NOT EXISTS public.project_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE (user_id, project_id),
  CHECK (user_id != invited_by) -- Can't invite yourself
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id 
  ON public.project_collaborators(user_id);
  
CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_id 
  ON public.project_collaborators(project_id);
  
CREATE INDEX IF NOT EXISTS idx_project_collaborators_role 
  ON public.project_collaborators(project_id, role) 
  WHERE accepted_at IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER project_collaborators_updated_at
  BEFORE UPDATE ON public.project_collaborators
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- View: Any collaborator can see other collaborators in same project
CREATE POLICY "collaborators_select_policy"
  ON public.project_collaborators FOR SELECT
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- Insert: Only admins can add new collaborators
CREATE POLICY "collaborators_insert_policy"
  ON public.project_collaborators FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_collaborators
      WHERE project_id = project_collaborators.project_id
        AND user_id = auth.uid()
        AND role = 'admin'
        AND accepted_at IS NOT NULL
    )
  );

-- Update: Only admins can modify roles or other fields
CREATE POLICY "collaborators_update_policy"
  ON public.project_collaborators FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_collaborators
      WHERE project_id = project_collaborators.project_id
        AND user_id = auth.uid()
        AND role = 'admin'
        AND accepted_at IS NOT NULL
    )
  );

-- Delete: Only admins can remove collaborators
CREATE POLICY "collaborators_delete_policy"
  ON public.project_collaborators FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc2
      WHERE pc2.project_id = project_collaborators.project_id
        AND pc2.user_id = auth.uid()
        AND pc2.role = 'admin'
        AND pc2.accepted_at IS NOT NULL
    )
  );

-- Comments
COMMENT ON TABLE public.project_collaborators IS 'Junction table for user-project relationships with role-based permissions (admin/editor/viewer)';
COMMENT ON COLUMN public.project_collaborators.role IS 'Permission level: admin (full access + manage collaborators), editor (full read/write), viewer (read-only)';
COMMENT ON COLUMN public.project_collaborators.accepted_at IS 'NULL = pending invitation, NOT NULL = active collaborator';

