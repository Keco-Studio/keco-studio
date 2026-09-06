import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthedRequest } from '@/lib/auth/route-auth';
import {
  normalizeCurrency,
  validateCheckoutInput,
} from '@/lib/payment-domain';
import { getStripe } from '@/lib/stripe';
import {
  applyCheckoutAmountOverride,
  getStudioPlanById,
} from '@/lib/studio-plans';
import {
  attachStripeSession,
  createPaymentOrder,
} from '@/lib/supabase-payments';
import {
  AuthorizationError,
  getUserProjectRole,
} from '@/lib/services/authorizationService';

export const runtime = 'nodejs';

const checkoutHandler = async (
  request: NextRequest,
  _context: unknown,
  { supabase, user }: AuthedRequest
) => {
  try {
    const input = validateCheckoutInput(await request.json());
    try {
      await getUserProjectRole(supabase, input.projectId, user.id);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      throw error;
    }

    const catalogPlan = getStudioPlanById(input.planId);
    if (!catalogPlan || !catalogPlan.checkoutEnabled || catalogPlan.amountCents <= 0) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 400 });
    }
    const plan = applyCheckoutAmountOverride(catalogPlan);
    const currency = normalizeCurrency(plan.currency);
    const paymentId = `pay_${randomUUID()}`;
    const reference = `KECO-${new Date().getUTCFullYear()}-${paymentId.slice(-8).toUpperCase()}`;
    const stripe = getStripe();

    await createPaymentOrder({
      id: paymentId,
      reference,
      projectId: input.projectId,
      userId: user.id,
      planId: plan.id,
      planLabel: plan.label,
      customerEmail: input.customerEmail,
      amountCents: plan.amountCents,
      currency,
    });

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: input.customerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: plan.amountCents,
            product_data: {
              name: plan.label,
              description: plan.description,
            },
          },
        },
      ],
      metadata: {
        paymentId,
        paymentReference: reference,
        projectId: input.projectId,
        planId: plan.id,
        userId: user.id,
      },
      success_url: `${siteUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}&project_id=${encodeURIComponent(input.projectId)}`,
      cancel_url: `${siteUrl}/payment/cancel?payment_id=${encodeURIComponent(paymentId)}&project_id=${encodeURIComponent(input.projectId)}`,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a Checkout URL');
    }

    await attachStripeSession(paymentId, session.id);
    return NextResponse.json({ url: session.url, paymentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start checkout';
    if (/Project not found|not a collaborator|Forbidden/i.test(message)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const status = /required|valid|not found|only USD/i.test(message)
      ? 400
      : /not configured|Could not find the table/i.test(message)
        ? 503
        : 500;
    console.error('[API /checkout] Checkout session creation failed', error);
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Unable to start checkout'
            : /Could not find the table/i.test(message)
              ? 'Payment tables are missing. Apply the stripe payments migration.'
              : /STRIPE_SECRET_KEY|Stripe is not configured/i.test(message)
                ? 'Payments are temporarily unavailable. Stripe is not configured for this environment.'
                : message,
      },
      { status }
    );
  }
};

export const POST = withAuth(checkoutHandler);
