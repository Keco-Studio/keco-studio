-- Claim a Stripe event, update its Checkout order, and grant Credits atomically.

CREATE OR REPLACE FUNCTION public.process_stripe_checkout_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_session_id TEXT,
  p_status TEXT,
  p_payment_intent_id TEXT,
  p_payload JSONB,
  p_credit_amount BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'Stripe event ID is required' USING ERRCODE = '22023';
  END IF;
  IF p_event_type IS NULL OR btrim(p_event_type) = '' THEN
    RAISE EXCEPTION 'Stripe event type is required' USING ERRCODE = '22023';
  END IF;

  IF p_session_id IS NULL THEN
    IF p_status IS NOT NULL
      OR p_payment_intent_id IS NOT NULL
      OR COALESCE(p_credit_amount, 0) <> 0
    THEN
      RAISE EXCEPTION 'Non-Checkout Stripe events cannot mutate payment state'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_status IS NULL OR p_status NOT IN ('paid', 'failed') THEN
      RAISE EXCEPTION 'Invalid Stripe payment status' USING ERRCODE = '22023';
    END IF;
    IF p_status = 'paid' AND (p_credit_amount IS NULL OR p_credit_amount <= 0) THEN
      RAISE EXCEPTION 'Paid Stripe events require a positive Credit grant'
        USING ERRCODE = '22023';
    END IF;
    IF p_status <> 'paid' AND COALESCE(p_credit_amount, 0) <> 0 THEN
      RAISE EXCEPTION 'Unpaid Stripe events cannot grant Credits'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.payment_webhook_events (id, event_type, payload)
  VALUES (p_event_id, p_event_type, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('processed', false, 'orderId', NULL);
  END IF;

  IF p_session_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('processed', true, 'orderId', NULL);
  END IF;

  SELECT payment_order.*
  INTO v_order
  FROM public.payment_orders AS payment_order
  WHERE payment_order.stripe_checkout_session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment order not found for Checkout session %', p_session_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_status = 'paid' AND v_order.user_id IS NULL THEN
    RAISE EXCEPTION 'Payment order % does not have a Credit recipient', v_order.id
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.payment_orders
  SET
    status = p_status,
    stripe_payment_intent_id = p_payment_intent_id,
    paid_at = CASE
      WHEN p_status = 'paid' THEN COALESCE(v_order.paid_at, pg_catalog.clock_timestamp())
      ELSE NULL
    END,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_order.id;

  IF p_status = 'paid' THEN
    INSERT INTO public.credit_ledger_entries (
      user_id,
      credit_delta,
      reason,
      reference_key
    ) VALUES (
      v_order.user_id,
      p_credit_amount,
      'Stripe ' || v_order.plan_label || ' purchase',
      'stripe-checkout:' || p_session_id
    )
    ON CONFLICT (reference_key) DO NOTHING;
  END IF;

  RETURN pg_catalog.jsonb_build_object('processed', true, 'orderId', v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION public.process_stripe_checkout_event(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BIGINT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_stripe_checkout_event(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BIGINT
) TO service_role;

NOTIFY pgrst, 'reload schema';
