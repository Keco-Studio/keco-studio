-- Semantic read enhancement: library_row + library_schema source types and library scope expansion.

ALTER TABLE public.agent_embedding_chunks
  DROP CONSTRAINT IF EXISTS agent_embedding_chunks_source_type_check;

ALTER TABLE public.agent_embedding_chunks
  ADD CONSTRAINT agent_embedding_chunks_source_type_check
  CHECK (source_type IN (
    'chat_message',
    'library_cell',
    'library_row',
    'library_schema',
    'design_document'
  ));

-- Cascade delete library_row chunks when the asset is removed.
CREATE OR REPLACE FUNCTION public.delete_agent_embedding_chunks_for_library_asset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.agent_embedding_chunks
  WHERE source_type = 'library_row'
    AND source_id = OLD.id::text || ':row';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_embedding_chunks_library_row ON public.library_assets;
CREATE TRIGGER trg_delete_embedding_chunks_library_row
  AFTER DELETE ON public.library_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_agent_embedding_chunks_for_library_asset();

-- Cascade delete library_schema chunks when the library is removed.
CREATE OR REPLACE FUNCTION public.delete_agent_embedding_chunks_for_library()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.agent_embedding_chunks
  WHERE source_type = 'library_schema'
    AND source_id = OLD.id::text || ':schema';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_embedding_chunks_library_schema ON public.libraries;
CREATE TRIGGER trg_delete_embedding_chunks_library_schema
  AFTER DELETE ON public.libraries
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_agent_embedding_chunks_for_library();

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
      NULLIF(c.metadata->>'schemaUpdatedAt', '')::timestamptz,
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
        AND c.source_type IN ('library_cell', 'library_row', 'library_schema'))
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
