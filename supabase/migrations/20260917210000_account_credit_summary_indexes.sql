-- Index the per-user inputs used by Account Credit summaries.

CREATE INDEX ai_usage_events_credit_user_idx
  ON public.ai_usage_events (user_id)
  WHERE pricing_rule_version = 1
    OR (
      provider = 'deepseek'
      AND request_kind = 'chat_completion'
      AND usage_status = 'unknown'
    );

CREATE INDEX credit_ledger_entries_user_id_idx
  ON public.credit_ledger_entries (user_id);

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
        AND (
          event.pricing_rule_version = 1
          OR (
            event.provider = 'deepseek'
            AND event.request_kind = 'chat_completion'
            AND event.usage_status = 'unknown'
          )
        )
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

NOTIFY pgrst, 'reload schema';
