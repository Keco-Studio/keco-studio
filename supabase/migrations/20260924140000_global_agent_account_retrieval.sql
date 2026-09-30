-- Account memory consists only of chat chunks from the caller's account conversation.
ALTER TABLE public.agent_embedding_chunks
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.agent_embedding_chunks
  ADD CONSTRAINT agent_embedding_chunks_account_chat_only
  CHECK (
    project_id IS NOT NULL
    OR (source_type = 'chat_message' AND user_id IS NOT NULL AND conversation_id IS NOT NULL)
  );

DROP POLICY IF EXISTS "Users read embedding chunks in their projects" ON public.agent_embedding_chunks;
CREATE POLICY "Users read embedding chunks in their projects" ON public.agent_embedding_chunks
FOR SELECT USING (
  (
    public.user_has_project_access(project_id, auth.uid())
    AND (source_type <> 'chat_message' OR user_id = auth.uid())
  )
  OR (
    project_id IS NULL
    AND source_type = 'chat_message'
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.agent_conversations conversation
      WHERE conversation.id = conversation_id
        AND conversation.user_id = auth.uid()
        AND conversation.project_id IS NULL
    )
  )
);

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
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN;
  END IF;

  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF p_project_id IS NULL THEN
    IF p_scope IS DISTINCT FROM 'chat_same_conversation'
      OR p_conversation_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.agent_conversations conversation
        WHERE conversation.id = p_conversation_id
          AND conversation.user_id = p_user_id
          AND conversation.project_id IS NULL
      ) THEN
      RETURN;
    END IF;
  ELSIF NOT public.user_has_project_access(p_project_id, p_user_id) THEN
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
  WHERE (1 - (c.embedding <=> p_query_embedding)) >= p_min_score
    AND (
      (
        p_project_id IS NULL
        AND c.project_id IS NULL
        AND c.source_type = 'chat_message'
        AND c.conversation_id = p_conversation_id
        AND c.user_id = p_user_id
      )
      OR (
        p_project_id IS NOT NULL
        AND c.project_id = p_project_id
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
      )
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
