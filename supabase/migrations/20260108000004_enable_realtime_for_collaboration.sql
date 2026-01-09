-- Migration: Enable Supabase Realtime for collaboration tables
-- Purpose: Enable real-time subscriptions for collaborative editing and presence
-- Feature: Real-time Project Collaboration

-- Enable realtime for collaboration tables
-- This allows clients to subscribe to database changes via Supabase Realtime

-- Project collaborators - for real-time collaborator list updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_collaborators;

-- Library assets - for real-time cell edit broadcasts
ALTER PUBLICATION supabase_realtime ADD TABLE public.library_assets;

-- Library asset values - for real-time cell value changes
ALTER PUBLICATION supabase_realtime ADD TABLE public.library_asset_values;

-- Note: Presence data (cursor position, active cell) is ephemeral
-- and managed via Supabase Realtime Presence API (not stored in database)

-- Comments
COMMENT ON PUBLICATION supabase_realtime IS 'Realtime publication for collaborative editing - includes project_collaborators, library_assets, library_asset_values';

