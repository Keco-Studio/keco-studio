import 'server-only';

import type { InternalPaymentStatus } from '@/lib/payment-domain';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { getStudioPlanById } from '@/lib/studio-plans';

export type PaymentOrderInput = {
  id: string;
  reference: string;
  projectId: string | null;
  userId: string;
  planId: string;
  planLabel: string;
  customerEmail: string;
  amountCents: number;
  currency: 'usd';
};

export async function createPaymentOrder(input: PaymentOrderInput) {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('payment_orders')
    .insert({
      id: input.id,
      reference: input.reference,
      project_id: input.projectId,
      user_id: input.userId,
      plan_id: input.planId,
      plan_label: input.planLabel,
      customer_email: input.customerEmail,
      amount_cents: input.amountCents,
      currency: input.currency,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create payment order: ${error.message}`);
  }
  return data;
}

export async function attachStripeSession(paymentId: string, sessionId: string) {
  const supabase = getSupabaseServiceRoleClient();
  const { error } = await supabase
    .from('payment_orders')
    .update({ stripe_checkout_session_id: sessionId })
    .eq('id', paymentId);

  if (error) {
    throw new Error(`Failed to attach Stripe session: ${error.message}`);
  }
}

export async function recordWebhookEvent(
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const supabase = getSupabaseServiceRoleClient();
  const { error } = await supabase.from('payment_webhook_events').insert({
    id: eventId,
    event_type: eventType,
    payload,
  });

  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error(`Failed to record webhook event: ${error.message}`);
}

export async function hasWebhookEvent(eventId: string): Promise<boolean> {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('payment_webhook_events')
    .select('id')
    .eq('id', eventId)
    .limit(1);

  if (error) {
    throw new Error(`Failed to check webhook event: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

export async function updatePaymentOrderFromStripe(input: {
  sessionId: string;
  status: InternalPaymentStatus;
  paymentIntentId?: string | null;
}) {
  const supabase = getSupabaseServiceRoleClient();
  const { data: order, error: orderError } = await supabase
    .from('payment_orders')
    .select('id, user_id, plan_id, plan_label')
    .eq('stripe_checkout_session_id', input.sessionId)
    .maybeSingle();

  if (orderError) {
    throw new Error(`Failed to load payment order: ${orderError.message}`);
  }
  if (!order) {
    throw new Error(`Payment order not found for Checkout session ${input.sessionId}`);
  }

  const plan = input.status === 'paid' ? getStudioPlanById(order.plan_id) : null;
  if (input.status === 'paid' && (!plan?.creditAmount || !order.user_id)) {
    throw new Error(`Payment order ${order.id} does not have a valid Credit grant`);
  }

  const { error } = await supabase
    .from('payment_orders')
    .update({
      status: input.status,
      stripe_payment_intent_id: input.paymentIntentId ?? null,
      paid_at: input.status === 'paid' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_checkout_session_id', input.sessionId);

  if (error) {
    throw new Error(`Failed to update payment order: ${error.message}`);
  }

  if (input.status === 'paid' && plan?.creditAmount && order.user_id) {
    const { error: creditError } = await supabase.from('credit_ledger_entries').insert({
      user_id: order.user_id,
      credit_delta: plan.creditAmount,
      reason: `Stripe ${order.plan_label} purchase`,
      reference_key: `stripe-checkout:${input.sessionId}`,
    });

    if (creditError && creditError.code !== '23505') {
      throw new Error(`Failed to grant purchased Credits: ${creditError.message}`);
    }
  }
}
