-- Index latest logical project-document Markdown alongside existing Agent sources.

ALTER TABLE public.agent_embedding_chunks
  DROP CONSTRAINT IF EXISTS agent_embedding_chunks_source_type_check;

ALTER TABLE public.agent_embedding_chunks
  ADD CONSTRAINT agent_embedding_chunks_source_type_check
  CHECK (source_type IN (
    'chat_message',
    'library_cell',
    'library_row',
    'library_schema',
    'design_document',
    'project_document'
  ));

CREATE OR REPLACE FUNCTION public.delete_agent_embedding_chunks_for_project_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.agent_embedding_chunks
  WHERE source_type = 'project_document'
    AND source_id LIKE OLD.id::text || ':%';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_embedding_chunks_project_document ON public.documents;
CREATE TRIGGER trg_delete_embedding_chunks_project_document
  AFTER DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_agent_embedding_chunks_for_project_document();

CREATE OR REPLACE FUNCTION public.replace_project_document_embedding_chunks(
  p_project_id uuid,
  p_document_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_expected_update_ids uuid[],
  p_rows jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_document public.documents%ROWTYPE;
  v_tail_ids uuid[];
BEGIN
  SELECT d.*
  INTO v_document
  FROM public.documents d
  WHERE d.id = p_document_id
    AND d.project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_document.updated_at IS DISTINCT FROM p_expected_updated_at
    OR v_document.collab_epoch IS DISTINCT FROM p_expected_epoch
    OR v_document.collab_revision IS DISTINCT FROM p_expected_revision THEN
    RETURN false;
  END IF;

  SELECT COALESCE(
    array_agg(u.id ORDER BY u.created_at, u.id),
    ARRAY[]::uuid[]
  )
  INTO v_tail_ids
  FROM public.document_yjs_updates u
  WHERE u.document_id = p_document_id
    AND u.epoch = v_document.collab_epoch;

  IF v_tail_ids <> COALESCE(p_expected_update_ids, ARRAY[]::uuid[]) THEN
    RETURN false;
  END IF;

  DELETE FROM public.agent_embedding_chunks
  WHERE project_id = p_project_id
    AND source_type = 'project_document'
    AND source_id LIKE p_document_id::text || ':%';

  INSERT INTO public.agent_embedding_chunks (
    project_id,
    user_id,
    source_type,
    source_id,
    conversation_id,
    chunk_index,
    content,
    content_hash,
    metadata,
    embedding,
    updated_at
  )
  SELECT
    p_project_id,
    NULL,
    'project_document',
    item->>'sourceId',
    NULL,
    (item->>'chunkIndex')::int,
    item->>'content',
    item->>'contentHash',
    COALESCE(item->'metadata', '{}'::jsonb),
    (item->'embedding')::text::vector(1536),
    now()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS item;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_project_document_embedding_chunks(
  uuid, uuid, timestamptz, bigint, bigint, uuid[], jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_project_document_embedding_chunks(
  uuid, uuid, timestamptz, bigint, bigint, uuid[], jsonb
) TO service_role;

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
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN;
  END IF;

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
      NULLIF(c.metadata->>'documentUpdatedAt', '')::timestamptz,
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
      OR (p_scope = 'project_document'
        AND c.source_type = 'project_document')
    )
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.match_agent_embedding_chunks(
  vector(1536), uuid, uuid, uuid, text, int, float
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_agent_embedding_chunks(
  vector(1536), uuid, uuid, uuid, text, int, float
) TO authenticated, service_role;
