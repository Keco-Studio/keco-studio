import type Stripe from 'stripe';
import { getPaymentStatusForCheckoutEvent } from '@/lib/payment-domain';
import { getStripe, getStripeWebhookSecret } from '@/lib/stripe';
import {
  hasWebhookEvent,
  recordWebhookEvent,
  updatePaymentOrderFromStripe,
} from '@/lib/supabase-payments';

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
    if (await hasWebhookEvent(event.id)) {
      return Response.json({ received: true });
    }

    const status = getPaymentStatusForCheckoutEvent(event.type);
    if (status) {
      const session = event.data.object as Stripe.Checkout.Session;
      await updatePaymentOrderFromStripe({
        sessionId: session.id,
        status,
        paymentIntentId:
          typeof session.payment_intent === 'string' ? session.payment_intent : null,
      });
    }

    await recordWebhookEvent(event.id, event.type, {
      objectId: (event.data.object as { id?: string }).id ?? null,
    });

    return Response.json({ received: true });
  } catch (error) {
    console.error('[API /webhooks/stripe] Processing failed', error);
    return Response.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
