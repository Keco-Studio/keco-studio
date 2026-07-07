-- Security hardening bundle (issue #156).
--
-- Item 1: profiles email enumeration.
--   profiles_select_public was `using (true)` with no role restriction, so
--   anon-key clients could enumerate every user's email. Restrict it to the
--   authenticated role. profiles_select_own already covers self-reads, and
--   authenticated collaborators still need to resolve each other's display
--   names/emails.
--
-- Item 2: tiptap-images open upload.
--   The insert policy only checked bucket_id, letting any caller drop files
--   anywhere in the (public) bucket. Scope inserts to the uploader's own
--   {user_id}/ folder, matching the library-media-files pattern and the path
--   already produced by imageUploadService ({userId}/{timestamp}-{filename}).

-- Item 1 -----------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_public ON public.profiles;
CREATE POLICY profiles_select_public ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Item 2 -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated uploads to tiptap-images" ON storage.objects;
CREATE POLICY "Authenticated uploads to tiptap-images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tiptap-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
