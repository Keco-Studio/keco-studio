import 'server-only';

import type { InternalPaymentStatus } from '@/lib/payment-domain';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

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

export type StripeCheckoutEventInput = {
  eventId: string;
  eventType: string;
  sessionId: string | null;
  status: InternalPaymentStatus | null;
  paymentIntentId?: string | null;
  payload: Record<string, unknown>;
  creditAmount: number;
};

export type StripeCheckoutEventResult = {
  processed: boolean;
  orderId: string | null;
};

export async function processStripeCheckoutEvent(
  input: StripeCheckoutEventInput,
): Promise<StripeCheckoutEventResult> {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase.rpc('process_stripe_checkout_event', {
    p_event_id: input.eventId,
    p_event_type: input.eventType,
    p_session_id: input.sessionId,
    p_status: input.status,
    p_payment_intent_id: input.paymentIntentId ?? null,
    p_payload: input.payload,
    p_credit_amount: input.creditAmount,
  });

  if (error) {
    throw new Error(`Failed to process Stripe webhook: ${error.message}`);
  }
  if (!data || typeof data !== 'object' || typeof data.processed !== 'boolean') {
    throw new Error('Failed to process Stripe webhook: invalid RPC response');
  }
  return data as StripeCheckoutEventResult;
}
