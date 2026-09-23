import type Stripe from 'stripe';
import { getPaymentStatusForCheckoutEvent } from '@/lib/payment-domain';
import { getStripe, getStripeWebhookSecret } from '@/lib/stripe';
import { getStudioPlanById } from '@/lib/studio-plans';
import { processStripeCheckoutEvent } from '@/lib/supabase-payments';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return Response.json({ error: 'Missing Stripe signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      await request.text(),
      signature,
      getStripeWebhookSecret()
    );
  } catch (error) {
    console.error('[API /webhooks/stripe] Signature verification failed', error);
    return Response.json({ error: 'Invalid webhook' }, { status: 400 });
  }

  try {
    const status = getPaymentStatusForCheckoutEvent(event.type);
    const object = event.data.object as Stripe.Checkout.Session;
    const session = status ? object : null;
    const plan = status === 'paid'
      ? getStudioPlanById(session?.metadata?.planId ?? '')
      : null;

    await processStripeCheckoutEvent({
      eventId: event.id,
      eventType: event.type,
      sessionId: session?.id ?? null,
      status,
      paymentIntentId: session && typeof session.payment_intent === 'string'
        ? session.payment_intent
        : null,
      payload: { objectId: object.id ?? null },
      creditAmount: plan?.creditAmount ?? 0,
    });

    return Response.json({ received: true });
  } catch (error) {
    console.error('[API /webhooks/stripe] Processing failed', error);
    return Response.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
