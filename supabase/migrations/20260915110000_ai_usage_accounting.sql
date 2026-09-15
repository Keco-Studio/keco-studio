-- Private, append-only accounting for outbound AI provider attempts.

CREATE OR REPLACE FUNCTION public.ai_usage_metadata_is_safe(p_metadata JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_metadata IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_metadata) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_metadata) AS item(key, value)
      WHERE NOT CASE
        WHEN item.key = 'fixture' THEN
          pg_catalog.jsonb_typeof(item.value) = 'string'
          AND item.value #>> '{}' ~ '^[a-z][a-z0-9_]{0,63}$'
        WHEN item.key = 'source' THEN
          pg_catalog.jsonb_typeof(item.value) = 'string'
          AND item.value #>> '{}' ~ '^[a-z][a-z0-9_]*$'
          AND pg_catalog.char_length(item.value #>> '{}') <= 4096
        WHEN item.key = 'embeddingType' THEN
          pg_catalog.jsonb_typeof(item.value) = 'string'
          AND item.value #>> '{}' IN ('index_batch', 'query')
        WHEN item.key = 'providerOperation' THEN
          pg_catalog.jsonb_typeof(item.value) = 'string'
          AND item.value #>> '{}' ~ '^[a-z][a-z0-9_]{0,63}$'
        WHEN item.key IN ('iteration', 'repairAttempt', 'retryAttempt') THEN
          pg_catalog.jsonb_typeof(item.value) = 'number'
          AND item.value #>> '{}' ~ '^(0|[1-9][0-9]*)$'
          AND pg_catalog.char_length(item.value #>> '{}') <= 4
          AND (item.value #>> '{}')::BIGINT BETWEEN 0 AND 1000
        WHEN item.key = 'batchSize' THEN
          pg_catalog.jsonb_typeof(item.value) = 'number'
          AND item.value #>> '{}' ~ '^(0|[1-9][0-9]*)$'
          AND pg_catalog.char_length(item.value #>> '{}') <= 5
          AND (item.value #>> '{}')::BIGINT BETWEEN 0 AND 10000
        WHEN item.key = 'inputCharacters' THEN
          pg_catalog.jsonb_typeof(item.value) = 'number'
          AND item.value #>> '{}' ~ '^(0|[1-9][0-9]*)$'
          AND pg_catalog.char_length(item.value #>> '{}') <= 8
          AND (item.value #>> '{}')::BIGINT BETWEEN 0 AND 10000000
        WHEN item.key IN ('regionColumn', 'regionRow', 'regionColumns', 'regionRows', 'sceneIndex') THEN
          pg_catalog.jsonb_typeof(item.value) = 'number'
          AND item.value #>> '{}' ~ '^(0|[1-9][0-9]*)$'
          AND pg_catalog.char_length(item.value #>> '{}') <= 5
          AND (item.value #>> '{}')::BIGINT BETWEEN 0 AND 65535
        ELSE FALSE
      END
    );
$$;

CREATE TABLE public.ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key UUID NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  feature TEXT NOT NULL CHECK (length(feature) BETWEEN 1 AND 100),
  operation TEXT NOT NULL CHECK (length(operation) BETWEEN 1 AND 100),
  request_kind TEXT NOT NULL CHECK (
    request_kind IN ('chat_completion', 'embedding', 'provider_generation')
  ),
  provider TEXT NOT NULL CHECK (
    provider IN ('deepseek', 'minimax', 'openai', 'pixellab', 'unknown')
  ),
  model TEXT CHECK (model IS NULL OR length(model) BETWEEN 1 AND 256),
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 256),
  job_id TEXT CHECK (job_id IS NULL OR length(job_id) BETWEEN 1 AND 256),
  artifact_id TEXT CHECK (artifact_id IS NULL OR length(artifact_id) BETWEEN 1 AND 256),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  provider_request_id TEXT CHECK (
    provider_request_id IS NULL OR length(provider_request_id) BETWEEN 1 AND 256
  ),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('succeeded', 'provider_error', 'transport_error', 'aborted')
  ),
  usage_status TEXT NOT NULL CHECK (usage_status IN ('reported', 'unknown')),
  input_tokens BIGINT,
  output_tokens BIGINT,
  total_tokens BIGINT,
  provider_credits NUMERIC CHECK (provider_credits IS NULL OR provider_credits >= 0),
  pricing_rule_version SMALLINT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL CHECK (finished_at >= started_at),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (
    (usage_status = 'unknown' AND input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL)
    OR
    (usage_status = 'reported'
      AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND total_tokens IS NOT NULL
      AND input_tokens >= 0 AND output_tokens >= 0
      AND total_tokens >= input_tokens + output_tokens)
  ),
  CHECK (
    pricing_rule_version IS NULL
    OR (pricing_rule_version = 1 AND provider = 'deepseek'
      AND request_kind = 'chat_completion' AND usage_status = 'reported')
  ),
  CONSTRAINT ai_usage_events_metadata_safe_check
    CHECK (public.ai_usage_metadata_is_safe(metadata)),
  CONSTRAINT ai_usage_events_metadata_size_check
    CHECK (pg_catalog.octet_length(metadata::text) <= 4096)
);

CREATE INDEX ai_usage_events_pricing_user_idx
  ON public.ai_usage_events (pricing_rule_version, user_id)
  WHERE pricing_rule_version = 1;

CREATE TABLE public.ai_usage_tracking_epochs (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  tracked_from TIMESTAMPTZ NOT NULL
);

INSERT INTO public.ai_usage_tracking_epochs (singleton, tracked_from)
VALUES (TRUE, pg_catalog.clock_timestamp());

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_tracking_epochs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_usage_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_usage_tracking_epochs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.ai_usage_events TO service_role;
REVOKE ALL ON FUNCTION public.ai_usage_metadata_is_safe(JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_usage_metadata_is_safe(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.record_ai_usage_event(p_event JSONB)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_event_key UUID;
  v_context_user_id UUID;
  v_project_id UUID;
  v_usage_status TEXT;
  v_input_tokens BIGINT;
  v_output_tokens BIGINT;
  v_total_tokens BIGINT;
  v_provider_credits NUMERIC;
  v_provider TEXT;
  v_request_kind TEXT;
  v_metadata JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' OR p_event ? 'user_id' THEN
    RAISE EXCEPTION 'Invalid AI usage event' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_event->'context') <> 'object' THEN
    RAISE EXCEPTION 'Invalid AI usage context' USING ERRCODE = '22023';
  END IF;

  v_context_user_id := (p_event #>> '{context,actorUserId}')::UUID;
  IF v_context_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'AI usage actor mismatch' USING ERRCODE = '42501';
  END IF;

  v_event_key := (p_event->>'eventKey')::UUID;
  v_project_id := NULLIF(p_event #>> '{context,projectId}', '')::UUID;
  v_provider := p_event->>'provider';
  v_request_kind := p_event->>'requestKind';
  v_metadata := COALESCE(p_event->'metadata', '{}'::jsonb);

  IF p_event->'usage' IS NULL OR p_event->'usage' = 'null'::jsonb THEN
    v_usage_status := 'unknown';
    v_input_tokens := NULL;
    v_output_tokens := NULL;
    v_total_tokens := NULL;
  ELSE
    IF jsonb_typeof(p_event->'usage') <> 'object' THEN
      RAISE EXCEPTION 'Invalid AI usage tokens' USING ERRCODE = '22023';
    END IF;
    v_usage_status := 'reported';
    v_input_tokens := (p_event #>> '{usage,inputTokens}')::BIGINT;
    v_output_tokens := (p_event #>> '{usage,outputTokens}')::BIGINT;
    v_total_tokens := (p_event #>> '{usage,totalTokens}')::BIGINT;
  END IF;

  IF p_event ? 'providerCredits' THEN
    v_provider_credits := (p_event->>'providerCredits')::NUMERIC;
  END IF;

  INSERT INTO public.ai_usage_events (
    event_key,
    user_id,
    project_id,
    feature,
    operation,
    request_kind,
    provider,
    model,
    correlation_id,
    job_id,
    artifact_id,
    attempt,
    provider_request_id,
    outcome,
    usage_status,
    input_tokens,
    output_tokens,
    total_tokens,
    provider_credits,
    pricing_rule_version,
    started_at,
    finished_at,
    metadata
  ) VALUES (
    v_event_key,
    v_user_id,
    v_project_id,
    p_event #>> '{context,feature}',
    p_event #>> '{context,operation}',
    v_request_kind,
    v_provider,
    p_event->>'model',
    p_event #>> '{context,correlationId}',
    NULLIF(p_event #>> '{context,jobId}', ''),
    NULLIF(p_event #>> '{context,artifactId}', ''),
    (p_event->>'attempt')::INTEGER,
    NULLIF(p_event->>'providerRequestId', ''),
    p_event->>'outcome',
    v_usage_status,
    v_input_tokens,
    v_output_tokens,
    v_total_tokens,
    v_provider_credits,
    CASE
      WHEN v_provider = 'deepseek'
        AND v_request_kind = 'chat_completion'
        AND v_usage_status = 'reported'
      THEN 1
      ELSE NULL
    END,
    (p_event->>'startedAt')::TIMESTAMPTZ,
    (p_event->>'finishedAt')::TIMESTAMPTZ,
    v_metadata
  ) ON CONFLICT (event_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_usage_event(JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_ai_usage_event(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.keco_admin_ai_usage_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH account_totals AS (
    SELECT
      COALESCE(SUM(event.total_tokens), 0)::BIGINT AS deepseek_tokens,
      COUNT(*) FILTER (
        WHERE event.provider = 'deepseek'
          AND event.request_kind = 'chat_completion'
          AND event.usage_status = 'unknown'
      )::BIGINT AS unknown_event_count
    FROM public.ai_usage_events AS event
    WHERE event.pricing_rule_version = 1
       OR (
         event.provider = 'deepseek'
         AND event.request_kind = 'chat_completion'
         AND event.usage_status = 'unknown'
       )
  ), user_totals AS (
    SELECT
      event.user_id,
      COALESCE(SUM(event.total_tokens) FILTER (WHERE event.pricing_rule_version = 1), 0)::BIGINT
        AS deepseek_tokens,
      COUNT(*) FILTER (
        WHERE event.provider = 'deepseek'
          AND event.request_kind = 'chat_completion'
          AND event.usage_status = 'unknown'
      )::BIGINT AS unknown_event_count
    FROM public.ai_usage_events AS event
    WHERE event.user_id IS NOT NULL
      AND (
        event.pricing_rule_version = 1
        OR (
          event.provider = 'deepseek'
          AND event.request_kind = 'chat_completion'
          AND event.usage_status = 'unknown'
        )
      )
    GROUP BY event.user_id
  ), user_summaries AS (
    SELECT jsonb_object_agg(
      user_total.user_id::TEXT,
      jsonb_build_object(
        'deepseekTokens', user_total.deepseek_tokens,
        'credits', CASE WHEN user_total.deepseek_tokens = 0 THEN 0
          ELSE (user_total.deepseek_tokens + 2) / 3 END,
        'unknownEventCount', user_total.unknown_event_count
      )
    ) AS users
    FROM user_totals AS user_total
  )
  SELECT jsonb_build_object(
    'trackedFrom', epoch.tracked_from,
    'deepseekTokens', account.deepseek_tokens,
    'credits', CASE WHEN account.deepseek_tokens = 0 THEN 0
      ELSE (account.deepseek_tokens + 2) / 3 END,
    'unknownEventCount', account.unknown_event_count,
    'users', COALESCE(user_summaries.users, '{}'::jsonb)
  )
  FROM public.ai_usage_tracking_epochs AS epoch
  CROSS JOIN account_totals AS account
  CROSS JOIN user_summaries;
$$;

REVOKE ALL ON FUNCTION public.keco_admin_ai_usage_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.keco_admin_ai_usage_summary() TO service_role;

NOTIFY pgrst, 'reload schema';
