import type Stripe from 'stripe';

export type InternalPaymentStatus = 'pending' | 'paid' | 'failed';

export type CheckoutInput = {
  planId: string;
  customerEmail: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCheckoutInput(value: unknown): CheckoutInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Request body is required');
  }
  const input = value as Record<string, unknown>;
  const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
  const customerEmail =
    typeof input.customerEmail === 'string' ? input.customerEmail.trim() : '';

  if (!planId) {
    throw new Error('A valid plan is required');
  }
  if (!customerEmail || !EMAIL_RE.test(customerEmail)) {
    throw new Error('A valid customer email is required');
  }

  return { planId, customerEmail };
}

export function normalizeCurrency(currency: string): 'usd' {
  if (currency.trim().toLowerCase() !== 'usd') {
    throw new Error('Only USD payments are supported');
  }
  return 'usd';
}

export function getPaymentStatusForCheckoutEvent(
  eventType: Stripe.Event.Type | string
): InternalPaymentStatus | null {
  if (eventType === 'checkout.session.completed') return 'paid';
  if (
    eventType === 'checkout.session.async_payment_failed' ||
    eventType === 'checkout.session.expired'
  ) {
    return 'failed';
  }
  return null;
}
