-- Migration: Enable Supabase Realtime for libraries and folders tables
-- Purpose: Allow collaborators to receive real-time updates for libraries and folders
-- Date: 2026-01-29

-- Enable realtime for libraries table
-- This allows clients to subscribe to library changes (create, update, delete)
ALTER PUBLICATION supabase_realtime ADD TABLE public.libraries;

-- Enable realtime for folders table
-- This allows clients to subscribe to folder changes (create, update, delete)
ALTER PUBLICATION supabase_realtime ADD TABLE public.folders;

-- Set REPLICA IDENTITY FULL to ensure DELETE events include all row data
ALTER TABLE public.libraries REPLICA IDENTITY FULL;
ALTER TABLE public.folders REPLICA IDENTITY FULL;

-- Comments
COMMENT ON TABLE public.libraries IS 'Libraries table with Realtime enabled for collaborative updates';
COMMENT ON TABLE public.folders IS 'Folders table with Realtime enabled for collaborative updates';

