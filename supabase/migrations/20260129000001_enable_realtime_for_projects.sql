-- Migration: Enable Supabase Realtime for projects table
-- Purpose: Allow collaborators to receive real-time updates when project info is modified or deleted
-- Date: 2026-01-29

-- Enable realtime for projects table
-- This allows clients to subscribe to project changes (name, description updates, deletions)
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;

-- Set REPLICA IDENTITY FULL to ensure DELETE events include all row data
ALTER TABLE public.projects REPLICA IDENTITY FULL;

-- Comments
COMMENT ON TABLE public.projects IS 'Projects table with Realtime enabled for collaborative updates';

