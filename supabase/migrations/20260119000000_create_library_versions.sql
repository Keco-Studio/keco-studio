-- Migration: Create library_versions table
-- Purpose: Support version control for libraries with snapshot storage and restore functionality
-- Feature: Library Version Control

-- Create the table
CREATE TABLE IF NOT EXISTS public.library_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  version_name TEXT NOT NULL,
  version_type TEXT NOT NULL CHECK (version_type IN ('manual', 'restore', 'backup')),
  parent_version_id UUID REFERENCES public.library_versions(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_data JSONB NOT NULL,
  restore_from_version_id UUID REFERENCES public.library_versions(id) ON DELETE SET NULL,
  restored_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  restored_at TIMESTAMPTZ,
  is_current BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Constraints
  CONSTRAINT library_versions_name_not_empty CHECK (length(trim(version_name)) > 0)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_library_versions_library_id 
  ON public.library_versions(library_id);

CREATE INDEX IF NOT EXISTS idx_library_versions_created_at 
  ON public.library_versions(created_at DESC);

-- Partial unique index to ensure only one current version per library
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_versions_unique_current 
  ON public.library_versions(library_id) 
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_library_versions_version_type 
  ON public.library_versions(library_id, version_type);

CREATE INDEX IF NOT EXISTS idx_library_versions_created_by 
  ON public.library_versions(created_by);

-- Index for JSONB snapshot_data queries (if needed in future)
CREATE INDEX IF NOT EXISTS idx_library_versions_snapshot_data 
  ON public.library_versions USING GIN (snapshot_data);

-- Enable RLS
ALTER TABLE public.library_versions ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- View: Users can see versions of libraries they have access to
CREATE POLICY "library_versions_select_policy"
  ON public.library_versions FOR SELECT
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() AND pc.accepted_at IS NOT NULL
    )
    OR
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.projects p ON l.project_id = p.id
      WHERE p.owner_id = auth.uid()
    )
  );

-- Insert: Only admins and editors can create versions
CREATE POLICY "library_versions_insert_policy"
  ON public.library_versions FOR INSERT
  WITH CHECK (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
    OR
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.projects p ON l.project_id = p.id
      WHERE p.owner_id = auth.uid()
    )
  );

-- Update: Only admins and editors can update versions (e.g., rename, mark as current)
CREATE POLICY "library_versions_update_policy"
  ON public.library_versions FOR UPDATE
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
    OR
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.projects p ON l.project_id = p.id
      WHERE p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
    OR
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.projects p ON l.project_id = p.id
      WHERE p.owner_id = auth.uid()
    )
  );

-- Delete: Only admins and editors can delete versions (but not current version)
CREATE POLICY "library_versions_delete_policy"
  ON public.library_versions FOR DELETE
  USING (
    is_current = FALSE
    AND (
      library_id IN (
        SELECT l.id 
        FROM public.libraries l
        JOIN public.project_collaborators pc ON l.project_id = pc.project_id
        WHERE pc.user_id = auth.uid() 
          AND pc.role IN ('admin', 'editor')
          AND pc.accepted_at IS NOT NULL
      )
      OR
      library_id IN (
        SELECT l.id 
        FROM public.libraries l
        JOIN public.projects p ON l.project_id = p.id
        WHERE p.owner_id = auth.uid()
      )
    )
  );

-- Function to ensure only one current version per library
-- This function will be called via trigger to enforce the constraint
CREATE OR REPLACE FUNCTION public.ensure_single_current_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If setting a version as current, unset all other current versions for this library
  IF NEW.is_current = TRUE THEN
    UPDATE public.library_versions
    SET is_current = FALSE
    WHERE library_id = NEW.library_id
      AND id != NEW.id
      AND is_current = TRUE;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger to enforce single current version
CREATE TRIGGER library_versions_ensure_single_current
  BEFORE INSERT OR UPDATE OF is_current ON public.library_versions
  FOR EACH ROW
  WHEN (NEW.is_current = TRUE)
  EXECUTE FUNCTION public.ensure_single_current_version();

-- Comments
COMMENT ON TABLE public.library_versions IS 'Stores version snapshots of libraries for version control and restore functionality';
COMMENT ON COLUMN public.library_versions.version_type IS 'Type of version: manual (user created), restore (restored from another version), backup (backup of current version before restore)';
COMMENT ON COLUMN public.library_versions.parent_version_id IS 'For restore versions: points to the backed-up version if backup was enabled during restore';
COMMENT ON COLUMN public.library_versions.snapshot_data IS 'Complete JSON snapshot of library data including all assets, field definitions, and configuration at the time of version creation';
COMMENT ON COLUMN public.library_versions.restore_from_version_id IS 'For restore versions: points to the version that was restored';
COMMENT ON COLUMN public.library_versions.is_current IS 'Indicates if this version is the current active version for the library. Only one version can be current per library.';
COMMENT ON COLUMN public.library_versions.metadata IS 'Additional metadata stored as JSON (e.g., restore notes, tags, etc.)';

