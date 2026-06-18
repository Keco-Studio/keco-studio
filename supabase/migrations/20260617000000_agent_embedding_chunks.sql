-- Agent vector memory: pgvector extension, embedding chunks table, match RPC, RLS.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.agent_embedding_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('chat_message', 'library_cell', 'design_document')),
  source_id text NOT NULL,
  conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  chunk_index int NOT NULL DEFAULT 0,
  content text NOT NULL,
  content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_embedding_chunks_unique UNIQUE (source_type, source_id, chunk_index, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_agent_embedding_chunks_project_source
  ON public.agent_embedding_chunks (project_id, source_type);

CREATE INDEX IF NOT EXISTS idx_agent_embedding_chunks_conversation
  ON public.agent_embedding_chunks (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_embedding_chunks_user
  ON public.agent_embedding_chunks (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_embedding_chunks_embedding_hnsw
  ON public.agent_embedding_chunks
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.agent_embedding_chunks ENABLE ROW LEVEL SECURITY;

-- Clients never read/write directly; service role used by indexing pipeline.
DROP POLICY IF EXISTS "Service role manages embedding chunks" ON public.agent_embedding_chunks;
CREATE POLICY "Service role manages embedding chunks" ON public.agent_embedding_chunks
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read embedding chunks in their projects" ON public.agent_embedding_chunks;
CREATE POLICY "Users read embedding chunks in their projects" ON public.agent_embedding_chunks
  FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM public.project_collaborators WHERE user_id = auth.uid()
    )
    AND (
      source_type <> 'chat_message'
      OR user_id = auth.uid()
    )
  );

-- Cascade delete library cell chunks when source cell is removed.
CREATE OR REPLACE FUNCTION public.delete_agent_embedding_chunks_for_library_cell()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.agent_embedding_chunks
  WHERE source_type = 'library_cell'
    AND source_id = OLD.asset_id::text || ':' || OLD.field_id::text;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_embedding_chunks_library_cell ON public.library_asset_values;
CREATE TRIGGER trg_delete_embedding_chunks_library_cell
  AFTER DELETE ON public.library_asset_values
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_agent_embedding_chunks_for_library_cell();

CREATE OR REPLACE FUNCTION public.user_has_project_access(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.owner_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.project_collaborators pc
    WHERE pc.project_id = p_project_id AND pc.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.match_agent_embedding_chunks(
  p_query_embedding vector(1536),
  p_project_id uuid,
  p_user_id uuid,
  p_conversation_id uuid,
  p_scope text,
  p_match_count int,
  p_min_score float
)
RETURNS TABLE (
  id uuid,
  source_type text,
  content text,
  metadata jsonb,
  similarity float,
  source_timestamp timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR NOT public.user_has_project_access(p_project_id, p_user_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.source_type,
    c.content,
    c.metadata,
    (1 - (c.embedding <=> p_query_embedding))::float AS similarity,
    COALESCE(
      NULLIF(c.metadata->>'lastMessageAt', '')::timestamptz,
      NULLIF(c.metadata->>'cellUpdatedAt', '')::timestamptz,
      NULLIF(c.metadata->>'messageCreatedAt', '')::timestamptz,
      c.updated_at
    ) AS source_timestamp
  FROM public.agent_embedding_chunks c
  WHERE c.project_id = p_project_id
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_min_score
    AND (
      (p_scope = 'chat_same_conversation'
        AND c.source_type = 'chat_message'
        AND c.conversation_id = p_conversation_id
        AND c.user_id = p_user_id)
      OR (p_scope = 'chat_same_project'
        AND c.source_type = 'chat_message'
        AND c.user_id = p_user_id
        AND c.conversation_id IS DISTINCT FROM p_conversation_id)
      OR (p_scope = 'library'
        AND c.source_type = 'library_cell')
      OR (p_scope = 'design_document'
        AND c.source_type = 'design_document')
    )
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_agent_embedding_chunks(
  vector(1536), uuid, uuid, uuid, text, int, float
) TO authenticated, service_role;
