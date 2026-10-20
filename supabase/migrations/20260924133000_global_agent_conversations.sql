-- Account conversations have no project binding; project conversations still
-- require an accepted project collaborator membership.
ALTER TABLE public.agent_conversations
  ALTER COLUMN project_id DROP NOT NULL;

-- RLS checks row visibility, not whether an UPDATE changed a binding. Freeze
-- all authority-bearing conversation fields after creation.
CREATE OR REPLACE FUNCTION public.guard_agent_conversation_binding()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.meta->'scope' IS DISTINCT FROM OLD.meta->'scope'
    OR NEW.meta->'documentExport' IS DISTINCT FROM OLD.meta->'documentExport' THEN
    RAISE EXCEPTION 'Conversation binding is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_agent_conversation_binding ON public.agent_conversations;
CREATE TRIGGER trg_guard_agent_conversation_binding
BEFORE UPDATE ON public.agent_conversations
FOR EACH ROW EXECUTE FUNCTION public.guard_agent_conversation_binding();

DROP POLICY IF EXISTS "Users can view own conversations" ON public.agent_conversations;
CREATE POLICY "Users can view own conversations" ON public.agent_conversations
FOR SELECT USING (
  user_id = (SELECT auth.uid())
  AND (
    project_id IS NULL
    OR project_id IN (
      SELECT pc.project_id
      FROM public.project_collaborators pc
      WHERE pc.user_id = (SELECT auth.uid())
        AND pc.accepted_at IS NOT NULL
    )
  )
);

DROP POLICY IF EXISTS "Users can insert own conversations" ON public.agent_conversations;
CREATE POLICY "Users can insert own conversations" ON public.agent_conversations
FOR INSERT WITH CHECK (
  user_id = (SELECT auth.uid())
  AND (
    project_id IS NULL
    OR project_id IN (
      SELECT pc.project_id
      FROM public.project_collaborators pc
      WHERE pc.user_id = (SELECT auth.uid())
        AND pc.accepted_at IS NOT NULL
    )
  )
);

DROP POLICY IF EXISTS "Users can update own conversations" ON public.agent_conversations;
CREATE POLICY "Users can update own conversations" ON public.agent_conversations
FOR UPDATE USING (
  user_id = (SELECT auth.uid())
  AND (
    project_id IS NULL
    OR project_id IN (
      SELECT pc.project_id
      FROM public.project_collaborators pc
      WHERE pc.user_id = (SELECT auth.uid())
        AND pc.accepted_at IS NOT NULL
    )
  )
) WITH CHECK (
  user_id = (SELECT auth.uid())
  AND (
    project_id IS NULL
    OR project_id IN (
      SELECT pc.project_id
      FROM public.project_collaborators pc
      WHERE pc.user_id = (SELECT auth.uid())
        AND pc.accepted_at IS NOT NULL
    )
  )
);

DROP POLICY IF EXISTS "Users can delete own conversations" ON public.agent_conversations;
CREATE POLICY "Users can delete own conversations" ON public.agent_conversations
FOR DELETE USING (user_id = (SELECT auth.uid()));

CREATE INDEX IF NOT EXISTS idx_agent_conv_user_updated
  ON public.agent_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_conv_project_updated
  ON public.agent_conversations(project_id, updated_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_conv_scope_history
  ON public.agent_conversations(user_id, project_id, ((meta->'scope'->>'workspace')), updated_at DESC);

CREATE TABLE IF NOT EXISTS private.agent_project_creation_requests (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation text NOT NULL,
  idempotency_key uuid NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('completed')),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation, idempotency_key)
);

ALTER TABLE private.agent_project_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.agent_project_creation_requests FROM PUBLIC, anon, authenticated;

-- The private schema is outside PostgREST's exposed schemas. This definer
-- helper owns ledger access; its actor is always taken from the JWT.
CREATE OR REPLACE FUNCTION private.create_agent_project_idempotent(
  p_name text,
  p_description text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_operation constant text := 'create_project_with_default_resource';
  v_name text := pg_catalog.btrim(p_name);
  v_description text := nullif(pg_catalog.btrim(p_description), '');
  v_input_hash text;
  v_request private.agent_project_creation_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'Project name and idempotency key are required' USING ERRCODE = '22023';
  END IF;

  v_input_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object('name', v_name, 'description', v_description)::text,
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_user_id::text || ':' || v_operation || ':' || p_idempotency_key::text,
      0
    )
  );

  SELECT * INTO v_request
  FROM private.agent_project_creation_requests
  WHERE user_id = v_user_id
    AND operation = v_operation
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_request.input_hash <> v_input_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = 'KM409';
    END IF;
    RETURN v_request.result;
  END IF;

  v_result := public.create_project_with_default_resource(v_name, v_description)::jsonb;
  INSERT INTO private.agent_project_creation_requests (
    user_id, operation, idempotency_key, input_hash, status, result
  ) VALUES (
    v_user_id, v_operation, p_idempotency_key, v_input_hash, 'completed', v_result
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION private.create_agent_project_idempotent(text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.create_agent_project_idempotent(text, text, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.create_project_with_default_resource_idempotent(
  p_name text,
  p_description text,
  p_idempotency_key uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN private.create_agent_project_idempotent(
    p_name, p_description, p_idempotency_key
  )::json;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_with_default_resource_idempotent(text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_project_with_default_resource_idempotent(text, text, uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
