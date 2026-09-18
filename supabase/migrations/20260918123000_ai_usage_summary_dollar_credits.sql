-- Keep the legacy account-wide usage RPC aligned with dollar-based Credits.

CREATE OR REPLACE FUNCTION public.keco_admin_ai_usage_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH epoch AS (
    SELECT tracked_from
    FROM public.ai_usage_tracking_epochs
    WHERE singleton
  ), account_totals AS (
    SELECT
      COALESCE(SUM(event.total_tokens) FILTER (
        WHERE event.pricing_rule_version = 2
      ), 0)::BIGINT AS deepseek_tokens,
      COALESCE(SUM(event.usd_cost) FILTER (
        WHERE event.pricing_rule_version = 2
      ), 0) * 3 AS credits,
      COUNT(*) FILTER (
        WHERE event.provider = 'deepseek'
          AND event.request_kind = 'chat_completion'
          AND event.usage_status = 'unknown'
      )::BIGINT AS unknown_event_count
    FROM public.ai_usage_events AS event
    CROSS JOIN epoch
    WHERE event.created_at >= epoch.tracked_from
  ), user_totals AS (
    SELECT
      event.user_id,
      COALESCE(SUM(event.total_tokens) FILTER (
        WHERE event.pricing_rule_version = 2
      ), 0)::BIGINT AS deepseek_tokens,
      COALESCE(SUM(event.usd_cost) FILTER (
        WHERE event.pricing_rule_version = 2
      ), 0) * 3 AS credits,
      COUNT(*) FILTER (
        WHERE event.provider = 'deepseek'
          AND event.request_kind = 'chat_completion'
          AND event.usage_status = 'unknown'
      )::BIGINT AS unknown_event_count
    FROM public.ai_usage_events AS event
    CROSS JOIN epoch
    WHERE event.user_id IS NOT NULL
      AND event.created_at >= epoch.tracked_from
    GROUP BY event.user_id
  ), user_summaries AS (
    SELECT COALESCE(jsonb_object_agg(
      user_total.user_id::TEXT,
      jsonb_build_object(
        'deepseekTokens', user_total.deepseek_tokens,
        'credits', user_total.credits,
        'unknownEventCount', user_total.unknown_event_count
      )
    ), '{}'::JSONB) AS users
    FROM user_totals AS user_total
  )
  SELECT jsonb_build_object(
    'trackedFrom', epoch.tracked_from,
    'deepseekTokens', account.deepseek_tokens,
    'credits', account.credits,
    'unknownEventCount', account.unknown_event_count,
    'users', summaries.users
  )
  FROM epoch
  CROSS JOIN account_totals AS account
  CROSS JOIN user_summaries AS summaries;
$$;

REVOKE ALL ON FUNCTION public.keco_admin_ai_usage_summary() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.keco_admin_ai_usage_summary() TO service_role;

NOTIFY pgrst, 'reload schema';
