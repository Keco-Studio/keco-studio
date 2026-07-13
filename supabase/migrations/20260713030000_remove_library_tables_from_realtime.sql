-- Cell and asset edits use library-channel broadcasts. Reconciliation after a
-- reconnect covers broadcasts missed while the client was offline.
ALTER PUBLICATION supabase_realtime DROP TABLE public.library_asset_values;
ALTER PUBLICATION supabase_realtime DROP TABLE public.library_assets;

COMMENT ON PUBLICATION supabase_realtime IS
  'Realtime publication for collaboration metadata, including project_collaborators';
