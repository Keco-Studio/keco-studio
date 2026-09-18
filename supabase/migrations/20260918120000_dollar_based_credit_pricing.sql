-- Versioned provider prices and dollar-based Credit accounting.

CREATE TABLE public.ai_model_price_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('deepseek', 'minimax', 'openai', 'pixellab', 'unknown')),
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 256),
  rate_window TEXT NOT NULL CHECK (rate_window IN ('peak', 'off_peak')),
  effective_from TIMESTAMPTZ NOT NULL,
  cached_input_usd_per_million NUMERIC NOT NULL CHECK (cached_input_usd_per_million >= 0),
  uncached_input_usd_per_million NUMERIC NOT NULL CHECK (uncached_input_usd_per_million >= 0),
  output_usd_per_million NUMERIC NOT NULL CHECK (output_usd_per_million >= 0),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, model, rate_window, effective_from)
);

ALTER TABLE public.ai_model_price_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_model_price_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.ai_model_price_versions TO service_role;

INSERT INTO public.ai_model_price_versions (
  provider, model, rate_window, effective_from,
  cached_input_usd_per_million, uncached_input_usd_per_million, output_usd_per_million, note
) VALUES
  ('deepseek', 'deepseek-flash', 'off_peak', '2026-01-01T00:00:00Z', 0.003, 0.15, 0.60, 'Official price captured 2026-09-18'),
  ('deepseek', 'deepseek-flash', 'peak', '2026-01-01T00:00:00Z', 0.006, 0.30, 1.20, 'Official price captured 2026-09-18');

ALTER TABLE public.ai_usage_events
  ADD COLUMN input_cache_hit_tokens BIGINT,
  ADD COLUMN input_cache_miss_tokens BIGINT,
  ADD COLUMN price_version_id UUID REFERENCES public.ai_model_price_versions(id),
  ADD COLUMN usd_cost NUMERIC;

ALTER TABLE public.ai_usage_events
  ADD CONSTRAINT ai_usage_events_cache_tokens_check CHECK (
    (input_cache_hit_tokens IS NULL AND input_cache_miss_tokens IS NULL)
    OR (
      input_cache_hit_tokens >= 0
      AND input_cache_miss_tokens >= 0
      AND input_tokens = input_cache_hit_tokens + input_cache_miss_tokens
    )
  ),
  ADD CONSTRAINT ai_usage_events_usd_cost_check CHECK (usd_cost IS NULL OR usd_cost >= 0);

DO $$
DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.ai_usage_events'::regclass
      AND contype = 'c'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%pricing_rule_version%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_usage_events DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

ALTER TABLE public.ai_usage_events
  ADD CONSTRAINT ai_usage_events_pricing_rule_version_check CHECK (
    pricing_rule_version IS NULL
    OR (pricing_rule_version = 1 AND provider = 'deepseek'
      AND request_kind = 'chat_completion' AND usage_status = 'reported')
    OR (pricing_rule_version = 2 AND provider = 'deepseek'
      AND request_kind = 'chat_completion' AND usage_status = 'reported'
      AND price_version_id IS NOT NULL AND usd_cost IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.assign_ai_usage_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_window TEXT;
  v_price public.ai_model_price_versions%ROWTYPE;
BEGIN
  IF NEW.provider <> 'deepseek'
    OR NEW.request_kind <> 'chat_completion'
    OR NEW.usage_status <> 'reported' THEN
    RETURN NEW;
  END IF;

  IF NEW.input_cache_hit_tokens IS NULL THEN
    NEW.input_cache_hit_tokens := 0;
    NEW.input_cache_miss_tokens := NEW.input_tokens;
  END IF;

  v_window := CASE
    WHEN EXTRACT(ISODOW FROM NEW.finished_at) BETWEEN 1 AND 5
      AND (NEW.finished_at AT TIME ZONE 'UTC')::time >= TIME '01:00'
      AND ((NEW.finished_at AT TIME ZONE 'UTC')::time < TIME '04:00'
        OR ((NEW.finished_at AT TIME ZONE 'UTC')::time >= TIME '06:00'
          AND (NEW.finished_at AT TIME ZONE 'UTC')::time < TIME '10:00'))
    THEN 'peak'
    ELSE 'off_peak'
  END;

  SELECT * INTO v_price
  FROM public.ai_model_price_versions
  WHERE provider = NEW.provider
    AND model = NEW.model
    AND rate_window = v_window
    AND effective_from <= NEW.finished_at
  ORDER BY effective_from DESC
  LIMIT 1;

  IF FOUND THEN
    NEW.price_version_id := v_price.id;
    NEW.usd_cost := (
      NEW.input_cache_hit_tokens * v_price.cached_input_usd_per_million
      + NEW.input_cache_miss_tokens * v_price.uncached_input_usd_per_million
      + NEW.output_tokens * v_price.output_usd_per_million
    ) / 1000000;
    NEW.pricing_rule_version := 2;
  ELSE
    NEW.price_version_id := NULL;
    NEW.usd_cost := NULL;
    NEW.pricing_rule_version := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_usage_cost_before_insert
BEFORE INSERT ON public.ai_usage_events
FOR EACH ROW EXECUTE FUNCTION public.assign_ai_usage_cost();

CREATE OR REPLACE FUNCTION public.record_ai_usage_event(p_event JSONB)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_usage_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' OR p_event ? 'user_id'
    OR jsonb_typeof(p_event->'context') <> 'object'
    OR (p_event #>> '{context,actorUserId}')::UUID IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Invalid AI usage event' USING ERRCODE = '22023';
  END IF;
  v_usage_status := CASE WHEN p_event->'usage' IS NULL OR p_event->'usage' = 'null'::jsonb THEN 'unknown' ELSE 'reported' END;
  INSERT INTO public.ai_usage_events (
    event_key, user_id, project_id, feature, operation, request_kind, provider, model,
    correlation_id, job_id, artifact_id, attempt, provider_request_id, outcome, usage_status,
    input_tokens, input_cache_hit_tokens, input_cache_miss_tokens, output_tokens, total_tokens,
    provider_credits, pricing_rule_version, started_at, finished_at, metadata
  ) VALUES (
    (p_event->>'eventKey')::UUID, v_user_id, NULLIF(p_event #>> '{context,projectId}', '')::UUID,
    p_event #>> '{context,feature}', p_event #>> '{context,operation}', p_event->>'requestKind',
    p_event->>'provider', p_event->>'model', p_event #>> '{context,correlationId}',
    NULLIF(p_event #>> '{context,jobId}', ''), NULLIF(p_event #>> '{context,artifactId}', ''),
    (p_event->>'attempt')::INTEGER, NULLIF(p_event->>'providerRequestId', ''), p_event->>'outcome',
    v_usage_status,
    CASE WHEN v_usage_status = 'reported' THEN (p_event #>> '{usage,inputTokens}')::BIGINT END,
    CASE WHEN v_usage_status = 'reported' THEN (p_event #>> '{usage,inputCacheHitTokens}')::BIGINT END,
    CASE WHEN v_usage_status = 'reported' THEN (p_event #>> '{usage,inputCacheMissTokens}')::BIGINT END,
    CASE WHEN v_usage_status = 'reported' THEN (p_event #>> '{usage,outputTokens}')::BIGINT END,
    CASE WHEN v_usage_status = 'reported' THEN (p_event #>> '{usage,totalTokens}')::BIGINT END,
    CASE WHEN p_event ? 'providerCredits' THEN (p_event->>'providerCredits')::NUMERIC END,
    NULL, (p_event->>'startedAt')::TIMESTAMPTZ, (p_event->>'finishedAt')::TIMESTAMPTZ,
    COALESCE(p_event->'metadata', '{}'::jsonb)
  ) ON CONFLICT (event_key) DO NOTHING;
END;
$$;

UPDATE public.ai_usage_tracking_epochs SET tracked_from = clock_timestamp() WHERE singleton;

CREATE OR REPLACE FUNCTION public.account_credit_summary()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id UUID := (SELECT auth.uid()); v_allocated NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(SUM(credit_delta), 0) INTO v_allocated FROM public.credit_ledger_entries WHERE user_id = v_user_id;
  IF v_allocated < 0 THEN RAISE EXCEPTION 'Account Credit allocation cannot be negative' USING ERRCODE = '22023'; END IF;
  RETURN (
    WITH totals AS (
      SELECT COALESCE(SUM(usd_cost) FILTER (WHERE pricing_rule_version = 2), 0) * 3 AS used,
        COALESCE(SUM(total_tokens) FILTER (WHERE pricing_rule_version = 2), 0) AS deepseek_tokens,
        COUNT(*) FILTER (WHERE provider = 'deepseek' AND request_kind = 'chat_completion'
          AND (usage_status = 'unknown' OR (usage_status = 'reported' AND pricing_rule_version IS NULL))) AS incomplete_count
      FROM public.ai_usage_events event CROSS JOIN public.ai_usage_tracking_epochs epoch
      WHERE event.user_id = v_user_id AND epoch.singleton AND event.created_at >= epoch.tracked_from
    ) SELECT jsonb_build_object('allocated', v_allocated, 'used', used,
      'remaining', GREATEST(v_allocated - used, 0), 'overage', GREATEST(used - v_allocated, 0),
      'deepseekTokens', deepseek_tokens, 'incompleteCount', incomplete_count, 'trackedFrom', epoch.tracked_from)
    FROM totals CROSS JOIN public.ai_usage_tracking_epochs epoch WHERE epoch.singleton
  );
END; $$;

REVOKE ALL ON FUNCTION public.account_credit_summary() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_credit_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.keco_admin_credit_summary()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.credit_ledger_entries GROUP BY user_id HAVING SUM(credit_delta) < 0) THEN
    RAISE EXCEPTION 'Account Credit allocation cannot be negative' USING ERRCODE = '22023';
  END IF;
  RETURN (
    WITH epoch AS (SELECT tracked_from FROM public.ai_usage_tracking_epochs WHERE singleton),
    allocation AS (SELECT user_id, SUM(credit_delta)::NUMERIC AS allocated FROM public.credit_ledger_entries GROUP BY user_id),
    usage AS (
      SELECT event.user_id, COALESCE(SUM(usd_cost) FILTER (WHERE pricing_rule_version = 2), 0) * 3 AS used,
        COALESCE(SUM(total_tokens) FILTER (WHERE pricing_rule_version = 2), 0) AS tokens,
        COUNT(*) FILTER (WHERE provider = 'deepseek' AND request_kind = 'chat_completion'
          AND (usage_status = 'unknown' OR (usage_status = 'reported' AND pricing_rule_version IS NULL))) AS incomplete
      FROM public.ai_usage_events event CROSS JOIN epoch
      WHERE event.user_id IS NOT NULL AND event.created_at >= epoch.tracked_from GROUP BY event.user_id
    ), ids AS (SELECT user_id FROM allocation UNION SELECT user_id FROM usage),
    values_by_user AS (
      SELECT ids.user_id, COALESCE(allocation.allocated, 0) AS allocated, COALESCE(usage.used, 0) AS used,
        COALESCE(usage.tokens, 0) AS tokens, COALESCE(usage.incomplete, 0) AS incomplete
      FROM ids LEFT JOIN allocation USING (user_id) LEFT JOIN usage USING (user_id)
    ), users AS (
      SELECT COALESCE(jsonb_object_agg(user_id::TEXT, jsonb_build_object('allocated', allocated, 'used', used,
        'remaining', GREATEST(allocated - used, 0), 'overage', GREATEST(used - allocated, 0),
        'deepseekTokens', tokens, 'incompleteCount', incomplete)), '{}'::JSONB) AS result FROM values_by_user
    ), account AS (
      SELECT COALESCE(SUM(allocated), 0) AS allocated, COALESCE(SUM(used), 0) AS used,
        COALESCE(SUM(tokens), 0) AS tokens, COALESCE(SUM(incomplete), 0) AS incomplete FROM values_by_user
    ) SELECT jsonb_build_object('allocated', account.allocated, 'used', account.used,
      'remaining', GREATEST(account.allocated - account.used, 0), 'overage', GREATEST(account.used - account.allocated, 0),
      'deepseekTokens', account.tokens, 'incompleteCount', account.incomplete, 'trackedFrom', epoch.tracked_from, 'users', users.result)
    FROM account CROSS JOIN epoch CROSS JOIN users
  );
END; $$;

REVOKE ALL ON FUNCTION public.keco_admin_credit_summary() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.keco_admin_credit_summary() TO service_role;

NOTIFY pgrst, 'reload schema';
