-- Private, append-only account Credit allocations and read-only summaries.

CREATE TABLE public.credit_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_delta BIGINT NOT NULL CHECK (credit_delta <> 0),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 256),
  reference_key TEXT NOT NULL UNIQUE CHECK (char_length(reference_key) BETWEEN 1 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.credit_ledger_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.credit_ledger_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.credit_ledger_entries TO service_role;

CREATE OR REPLACE FUNCTION public.account_credit_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_allocated BIGINT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(entry.credit_delta), 0)::BIGINT
  INTO v_allocated
  FROM public.credit_ledger_entries AS entry
  WHERE entry.user_id = v_user_id;

  IF v_allocated < 0 THEN
    RAISE EXCEPTION 'Account Credit allocation cannot be negative' USING ERRCODE = '22023';
  END IF;

  RETURN (
    WITH usage_totals AS (
      SELECT
        COALESCE(SUM(event.total_tokens) FILTER (
          WHERE event.pricing_rule_version = 1
        ), 0)::BIGINT AS deepseek_tokens,
        COUNT(*) FILTER (
          WHERE event.provider = 'deepseek'
            AND event.request_kind = 'chat_completion'
            AND event.usage_status = 'unknown'
        )::BIGINT AS incomplete_count
      FROM public.ai_usage_events AS event
      WHERE event.user_id = v_user_id
    ), usage_credits AS (
      SELECT
        usage.deepseek_tokens,
        usage.incomplete_count,
        (usage.deepseek_tokens + 2) / 3 AS used
      FROM usage_totals AS usage
    )
    SELECT pg_catalog.jsonb_build_object(
      'allocated', v_allocated,
      'used', usage.used,
      'remaining', CASE WHEN v_allocated > usage.used THEN v_allocated - usage.used ELSE 0 END,
      'overage', CASE WHEN usage.used > v_allocated THEN usage.used - v_allocated ELSE 0 END,
      'deepseekTokens', usage.deepseek_tokens,
      'incompleteCount', usage.incomplete_count,
      'trackedFrom', epoch.tracked_from
    )
    FROM public.ai_usage_tracking_epochs AS epoch
    CROSS JOIN usage_credits AS usage
    WHERE epoch.singleton
  );
END;
$$;

REVOKE ALL ON FUNCTION public.account_credit_summary() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_credit_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.keco_admin_credit_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.credit_ledger_entries AS entry
    GROUP BY entry.user_id
    HAVING SUM(entry.credit_delta) < 0
  ) THEN
    RAISE EXCEPTION 'Account Credit allocation cannot be negative' USING ERRCODE = '22023';
  END IF;

  RETURN (
    WITH allocation_by_user AS (
      SELECT
        entry.user_id,
        COALESCE(SUM(entry.credit_delta), 0)::BIGINT AS allocated
      FROM public.credit_ledger_entries AS entry
      GROUP BY entry.user_id
    ), usage_by_user AS (
      SELECT
        event.user_id,
        COALESCE(SUM(event.total_tokens) FILTER (
          WHERE event.pricing_rule_version = 1
        ), 0)::BIGINT AS deepseek_tokens,
        COUNT(*) FILTER (
          WHERE event.provider = 'deepseek'
            AND event.request_kind = 'chat_completion'
            AND event.usage_status = 'unknown'
        )::BIGINT AS incomplete_count
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
    ), usage_user_ids AS (
      SELECT DISTINCT event.user_id
      FROM public.ai_usage_events AS event
      WHERE event.user_id IS NOT NULL
    ), user_ids AS (
      SELECT allocation.user_id FROM allocation_by_user AS allocation
      UNION
      SELECT usage.user_id FROM usage_user_ids AS usage
    ), user_values AS (
      SELECT
        user_id.user_id,
        COALESCE(allocation.allocated, 0)::BIGINT AS allocated,
        COALESCE(usage.deepseek_tokens, 0)::BIGINT AS deepseek_tokens,
        COALESCE(usage.incomplete_count, 0)::BIGINT AS incomplete_count
      FROM user_ids AS user_id
      LEFT JOIN allocation_by_user AS allocation ON allocation.user_id = user_id.user_id
      LEFT JOIN usage_by_user AS usage ON usage.user_id = user_id.user_id
    ), user_summaries AS (
      SELECT COALESCE(pg_catalog.jsonb_object_agg(
        value.user_id::TEXT,
        pg_catalog.jsonb_build_object(
          'allocated', value.allocated,
          'used', (value.deepseek_tokens + 2) / 3,
          'remaining', CASE
            WHEN value.allocated > (value.deepseek_tokens + 2) / 3
            THEN value.allocated - (value.deepseek_tokens + 2) / 3
            ELSE 0
          END,
          'overage', CASE
            WHEN (value.deepseek_tokens + 2) / 3 > value.allocated
            THEN (value.deepseek_tokens + 2) / 3 - value.allocated
            ELSE 0
          END,
          'deepseekTokens', value.deepseek_tokens,
          'incompleteCount', value.incomplete_count
        )
      ), '{}'::JSONB) AS users
      FROM user_values AS value
    ), account_allocation AS (
      SELECT COALESCE(SUM(entry.credit_delta), 0)::BIGINT AS allocated
      FROM public.credit_ledger_entries AS entry
    ), account_usage AS (
      SELECT
        COALESCE(SUM(event.total_tokens) FILTER (
          WHERE event.pricing_rule_version = 1
        ), 0)::BIGINT AS deepseek_tokens,
        COUNT(*) FILTER (
          WHERE event.provider = 'deepseek'
            AND event.request_kind = 'chat_completion'
            AND event.usage_status = 'unknown'
        )::BIGINT AS incomplete_count
      FROM public.ai_usage_events AS event
    ), account_values AS (
      SELECT
        allocation.allocated,
        usage.deepseek_tokens,
        usage.incomplete_count,
        (usage.deepseek_tokens + 2) / 3 AS used
      FROM account_allocation AS allocation
      CROSS JOIN account_usage AS usage
    )
    SELECT pg_catalog.jsonb_build_object(
      'allocated', account.allocated,
      'used', account.used,
      'remaining', CASE WHEN account.allocated > account.used THEN account.allocated - account.used ELSE 0 END,
      'overage', CASE WHEN account.used > account.allocated THEN account.used - account.allocated ELSE 0 END,
      'deepseekTokens', account.deepseek_tokens,
      'incompleteCount', account.incomplete_count,
      'trackedFrom', epoch.tracked_from,
      'users', summaries.users
    )
    FROM public.ai_usage_tracking_epochs AS epoch
    CROSS JOIN account_values AS account
    CROSS JOIN user_summaries AS summaries
    WHERE epoch.singleton
  );
END;
$$;

REVOKE ALL ON FUNCTION public.keco_admin_credit_summary() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.keco_admin_credit_summary() TO service_role;

NOTIFY pgrst, 'reload schema';
