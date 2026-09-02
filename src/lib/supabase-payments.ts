import 'server-only';

import type { InternalPaymentStatus } from '@/lib/payment-domain';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

export type PaymentOrderInput = {
  id: string;
  reference: string;
  projectId: string;
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
}
